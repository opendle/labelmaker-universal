import type {
  ImageElement,
  LabelElement,
  LabelPlate,
} from "@labelmaker/domain";
import type { RasterAlignment, RasterPage } from "@labelmaker/printing";
import {
  millimetersToPixels,
  packMonochromeRows,
  rgbaToMonochrome,
  type MonochromeBitmap,
  type RgbaImage,
} from "./bitmap.js";
import {
  shapeLineStrokeWidthMm,
  shapeRenderGeometry,
} from "./shape-geometry.js";

export interface PlateRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly printableWidthMm: number;
  readonly rasterAlignment: RasterAlignment;
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
      target.rasterAlignment,
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
      brightness: element.brightness,
      contrast: element.contrast,
      mode: "floyd-steinberg",
      threshold: 128,
    });
    elements.push({
      ...element,
      source: monochromeBmpDataUrl(
        bitmap,
        element.transparentBackground !== false,
      ),
    });
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

function monochromeBmpDataUrl(
  bitmap: MonochromeBitmap,
  transparentBackground: boolean,
): string {
  if (transparentBackground) return transparentMonochromeBmpDataUrl(bitmap);
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
  return `data:image/bmp;base64,${encodeBase64(bytes)}`;
}

function transparentMonochromeBmpDataUrl(bitmap: MonochromeBitmap): string {
  const dibHeaderBytes = 108;
  const pixelOffset = 14 + dibHeaderBytes;
  const rowBytes = bitmap.widthPixels * 4;
  const pixelBytes = rowBytes * bitmap.heightPixels;
  const bytes = new Uint8Array(pixelOffset + pixelBytes);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, bytes.length, true);
  view.setUint32(10, pixelOffset, true);
  view.setUint32(14, dibHeaderBytes, true);
  view.setInt32(18, bitmap.widthPixels, true);
  view.setInt32(22, bitmap.heightPixels, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 3, true);
  view.setUint32(34, pixelBytes, true);
  view.setUint32(54, 0x00ff0000, true);
  view.setUint32(58, 0x0000ff00, true);
  view.setUint32(62, 0x000000ff, true);
  view.setUint32(66, 0xff000000, true);
  view.setUint32(70, 0x73524742, true);
  for (let y = 0; y < bitmap.heightPixels; y += 1) {
    const sourceY = bitmap.heightPixels - y - 1;
    for (let x = 0; x < bitmap.widthPixels; x += 1) {
      const black = bitmap.pixels[sourceY * bitmap.widthPixels + x] === 1;
      const offset = pixelOffset + y * rowBytes + x * 4;
      const value = black ? 0 : 255;
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
      bytes[offset + 3] = black ? 255 : 0;
    }
  }
  return `data:image/bmp;base64,${encodeBase64(bytes)}`;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 12_288;
  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += chunkSize) {
    const chunkEnd = Math.min(bytes.length, chunkStart + chunkSize);
    let encoded = "";
    for (let index = chunkStart; index < chunkEnd; index += 3) {
      const first = bytes[index] ?? 0;
      const hasSecond = index + 1 < bytes.length;
      const hasThird = index + 2 < bytes.length;
      const second = bytes[index + 1] ?? 0;
      const third = bytes[index + 2] ?? 0;
      encoded +=
        (BASE64_ALPHABET[first >> 2] ?? "") +
        (BASE64_ALPHABET[((first & 0x03) << 4) | (second >> 4)] ?? "") +
        (hasSecond
          ? (BASE64_ALPHABET[((second & 0x0f) << 2) | (third >> 6)] ?? "")
          : "=") +
        (hasThird ? (BASE64_ALPHABET[third & 0x3f] ?? "") : "=");
    }
    chunks.push(encoded);
  }
  return chunks.join("");
}

export function buildPlateSvg(
  plate: LabelPlate,
  widthPixels: number,
  heightPixels: number,
  printableWidthMm = plate.size.heightMm,
  marginTopMm = 0,
  marginBottomMm = 0,
  rasterAlignment: RasterAlignment = "center",
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
  if (
    rasterAlignment !== "start" &&
    rasterAlignment !== "center" &&
    rasterAlignment !== "end"
  ) {
    throw new RangeError("Printer raster alignment is invalid");
  }
  const unusedHeadWidthMm = plate.size.heightMm - printableWidthMm;
  const alignedBaseMm =
    rasterAlignment === "start"
      ? 0
      : rasterAlignment === "end"
        ? unusedHeadWidthMm
        : unusedHeadWidthMm / 2;
  const marginAdjustmentMm = (marginTopMm - marginBottomMm) / 2;
  const viewBoxY = alignedBaseMm + marginAdjustmentMm;
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
      if (element.shapeType === "line") {
        const y = element.yMm + element.heightMm / 2;
        return `<line x1="${number(element.xMm)}" y1="${number(y)}" x2="${number(element.xMm + element.widthMm)}" y2="${number(y)}" stroke="black" stroke-linecap="butt" stroke-width="${number(shapeLineStrokeWidthMm(element))}"${transform}/>`;
      }
      const geometry = shapeRenderGeometry(element);
      const x = element.xMm + geometry.insetMm;
      const y = element.yMm + geometry.insetMm;
      const fill = geometry.filled ? "black" : "none";
      const stroke = geometry.filled ? "none" : "black";
      if (element.shapeType === "circle") {
        return `<ellipse cx="${number(element.xMm + element.widthMm / 2)}" cy="${number(element.yMm + element.heightMm / 2)}" rx="${number(geometry.widthMm / 2)}" ry="${number(geometry.heightMm / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${number(geometry.strokeWidthMm)}"${transform}/>`;
      }
      return `<rect x="${number(x)}" y="${number(y)}" width="${number(geometry.widthMm)}" height="${number(geometry.heightMm)}" rx="${number(geometry.cornerRadiusMm)}" fill="${fill}" stroke="${stroke}" stroke-width="${number(geometry.strokeWidthMm)}"${transform}/>`;
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
