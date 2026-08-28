import type {
  ImageElement,
  LabelElement,
  LabelPlate,
} from "@labelmaker/domain";
import type { RasterPage } from "@labelmaker/printing";
import {
  millimetersToPixels,
  packMonochromeRows,
  rgbaToMonochrome,
  type MonochromeBitmap,
  type RgbaImage,
} from "@labelmaker/rendering";

export interface PlateRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly printableWidthMm: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
}

export type SvgRasterizer = (
  svg: string,
  widthPixels: number,
  heightPixels: number,
) => RgbaImage | Promise<RgbaImage>;

/** Render a plate and transpose it into head-line order for printer adapters. */
export async function renderPlateForPrinter(
  plate: LabelPlate,
  target: PlateRasterTarget,
  rasterize: SvgRasterizer,
): Promise<RasterPage> {
  if (
    !Number.isSafeInteger(target.rasterWidthPixels) ||
    target.rasterWidthPixels < 1
  ) {
    throw new RangeError("Printer raster width must be a positive integer");
  }
  const feedLengthPixels = millimetersToPixels(plate.size.widthMm, target.dpi);
  const preparedPlate = await preparePlateImages(plate, target.dpi, rasterize);
  const source = await rasterize(
    buildPlateSvg(
      preparedPlate,
      feedLengthPixels,
      target.rasterWidthPixels,
      target.printableWidthMm,
      target.marginTopMm,
      target.marginBottomMm,
    ),
    feedLengthPixels,
    target.rasterWidthPixels,
  );
  if (
    source.widthPixels !== feedLengthPixels ||
    source.heightPixels !== target.rasterWidthPixels
  ) {
    throw new RangeError("The SVG rasterizer returned the wrong dimensions");
  }
  const bitmap = rgbaToMonochrome(source, {
    mode: "floyd-steinberg",
    threshold: 160,
  });
  const pixels = new Uint8Array(target.rasterWidthPixels * feedLengthPixels);
  for (let sourceY = 0; sourceY < target.rasterWidthPixels; sourceY += 1) {
    for (let sourceX = 0; sourceX < feedLengthPixels; sourceX += 1) {
      const feedLine = feedLengthPixels - sourceX - 1;
      pixels[feedLine * target.rasterWidthPixels + sourceY] =
        bitmap.pixels[sourceY * feedLengthPixels + sourceX] ?? 0;
    }
  }
  return packMonochromeRows({
    widthPixels: target.rasterWidthPixels,
    heightPixels: feedLengthPixels,
    pixels,
  });
}

async function preparePlateImages(
  plate: LabelPlate,
  dpi: number,
  rasterize: SvgRasterizer,
): Promise<LabelPlate> {
  const elements: LabelElement[] = [];
  for (const element of plate.elements) {
    if (element.kind !== "image") {
      elements.push(element);
      continue;
    }
    validateImageSource(element.source);
    const width = Math.max(1, millimetersToPixels(element.widthMm, dpi));
    const height = Math.max(1, millimetersToPixels(element.heightMm, dpi));
    const source = await rasterize(
      buildImageFrameSvg(element, width, height),
      width,
      height,
    );
    if (source.widthPixels !== width || source.heightPixels !== height) {
      throw new RangeError(
        "The image rasterizer returned the wrong dimensions",
      );
    }
    const bitmap = rgbaToMonochrome(source, {
      blackLevel: element.threshold,
      mode: "floyd-steinberg",
      threshold: 128,
    });
    elements.push({ ...element, source: monochromeBmpDataUrl(bitmap) });
  }
  return { ...plate, elements };
}

function buildImageFrameSvg(
  element: ImageElement,
  widthPixels: number,
  heightPixels: number,
): string {
  const aspect = imageAspectRatio(element.fit);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPixels}" height="${heightPixels}" viewBox="0 0 ${widthPixels} ${heightPixels}"><rect width="${widthPixels}" height="${heightPixels}" fill="white"/><image x="0" y="0" width="${widthPixels}" height="${heightPixels}" href="${attribute(element.source)}" preserveAspectRatio="${aspect}"/></svg>`;
}

function monochromeBmpDataUrl(bitmap: MonochromeBitmap): string {
  const rowBytes = Math.ceil((bitmap.widthPixels * 3) / 4) * 4;
  const pixelBytes = rowBytes * bitmap.heightPixels;
  const bytes = new Uint8Array(54 + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, bitmap.widthPixels, true);
  view.setInt32(22, bitmap.heightPixels, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelBytes, true);
  for (let y = 0; y < bitmap.heightPixels; y += 1) {
    const sourceY = bitmap.heightPixels - y - 1;
    for (let x = 0; x < bitmap.widthPixels; x += 1) {
      const black = bitmap.pixels[sourceY * bitmap.widthPixels + x] === 1;
      const value = black ? 0 : 255;
      const offset = 54 + y * rowBytes + x * 3;
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
    }
  }
  return `data:image/bmp;base64,${Buffer.from(bytes).toString("base64")}`;
}

export function buildPlateSvg(
  plate: LabelPlate,
  widthPixels: number,
  heightPixels: number,
  printableWidthMm = plate.size.heightMm,
  marginTopMm = 0,
  marginBottomMm = 0,
): string {
  if (!Number.isFinite(printableWidthMm) || printableWidthMm <= 0) {
    throw new RangeError("Printer printable width must be greater than zero");
  }
  if (
    !Number.isFinite(marginTopMm) ||
    marginTopMm < 0 ||
    !Number.isFinite(marginBottomMm) ||
    marginBottomMm < 0
  ) {
    throw new RangeError("Printer margins must be zero or greater");
  }
  const nominalMediaHeightMm = marginTopMm + printableWidthMm + marginBottomMm;
  const viewBoxY =
    marginTopMm + (plate.size.heightMm - nominalMediaHeightMm) / 2;
  const body = plate.elements.map(renderElement).join("");
  const artwork = plate.mirrorPrint
    ? `<g transform="translate(${number(plate.size.widthMm)} 0) scale(-1 1)">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPixels}" height="${heightPixels}" viewBox="0 ${number(viewBoxY)} ${number(plate.size.widthMm)} ${number(printableWidthMm)}"><rect x="0" y="0" width="${number(plate.size.widthMm)}" height="${number(plate.size.heightMm)}" fill="white"/>${artwork}</svg>`;
}

function renderElement(element: LabelElement): string {
  const transform = rotation(element);
  switch (element.kind) {
    case "text": {
      const anchor =
        element.align === "left"
          ? "start"
          : element.align === "right"
            ? "end"
            : "middle";
      const x =
        element.align === "left"
          ? element.xMm
          : element.align === "right"
            ? element.xMm + element.widthMm
            : element.xMm + element.widthMm / 2;
      const fontSizeMm = (element.fontSizePt * 25.4) / 72;
      const lines = element.text.split(/\r\n?|\n/);
      const lineHeightMm =
        ((element.lineHeightPt ?? element.fontSizePt) * 25.4) / 72;
      const textHeightMm = lines.length * lineHeightMm;
      const blockTopMm =
        (element.verticalAlign ?? "middle") === "top"
          ? element.yMm
          : element.verticalAlign === "bottom"
            ? element.yMm + element.heightMm - textHeightMm
            : element.yMm + (element.heightMm - textHeightMm) / 2;
      const firstLineY = blockTopMm + lineHeightMm / 2;
      const tspans = lines
        .map(
          (line, index) =>
            `<tspan x="${number(x)}" y="${number(firstLineY + index * lineHeightMm)}">${line.length === 0 ? "&#160;" : text(line)}</tspan>`,
        )
        .join("");
      return `<text text-anchor="${anchor}" dominant-baseline="middle" font-family="${attribute(element.fontFamily)}" font-size="${number(fontSizeMm)}" font-weight="${element.fontWeight}" font-style="${element.fontStyle ?? "normal"}" fill="black"${transform}>${tspans}</text>`;
    }
    case "image": {
      validateImageSource(element.source);
      const aspect = imageAspectRatio(element.fit);
      return `<image x="${number(element.xMm)}" y="${number(element.yMm)}" width="${number(element.widthMm)}" height="${number(element.heightMm)}" href="${attribute(element.source)}" preserveAspectRatio="${aspect}"${transform}/>`;
    }
    case "rectangle": {
      const fill = element.filled ? "black" : "none";
      return `<rect x="${number(element.xMm)}" y="${number(element.yMm)}" width="${number(element.widthMm)}" height="${number(element.heightMm)}" rx="${number(element.cornerRadiusMm)}" fill="${fill}" stroke="black" stroke-width="${number(element.strokeWidthMm)}"${transform}/>`;
    }
    case "qr":
    case "barcode":
      throw new TypeError(`${element.kind} elements are not printable yet`);
  }
}

function validateImageSource(source: string): void {
  if (!/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(source)) {
    throw new TypeError("Only embedded raster images can be printed");
  }
}

function imageAspectRatio(fit: ImageElement["fit"]): string {
  return fit === "stretch"
    ? "none"
    : fit === "cover"
      ? "xMidYMid slice"
      : "xMidYMid meet";
}

function rotation(element: LabelElement): string {
  if (element.rotationDeg === 0) return "";
  const centerX = element.xMm + element.widthMm / 2;
  const centerY = element.yMm + element.heightMm / 2;
  return ` transform="rotate(${number(element.rotationDeg)} ${number(centerX)} ${number(centerY)})"`;
}

function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function text(value: string): string {
  return attribute(value).replaceAll("'", "&apos;");
}

function number(value: number): string {
  if (!Number.isFinite(value))
    throw new RangeError("SVG values must be finite");
  return String(value);
}
