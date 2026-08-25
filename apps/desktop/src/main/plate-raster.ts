import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import type { RasterPage } from "@labelmaker/printing";
import {
  millimetersToPixels,
  packMonochromeRows,
  rgbaToMonochrome,
  type RgbaImage,
} from "@labelmaker/rendering";

export interface PlateRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
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
  const source = await rasterize(
    buildPlateSvg(plate, feedLengthPixels, target.rasterWidthPixels),
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

export function buildPlateSvg(
  plate: LabelPlate,
  widthPixels: number,
  heightPixels: number,
): string {
  const body = plate.elements.map(renderElement).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPixels}" height="${heightPixels}" viewBox="0 0 ${number(plate.size.widthMm)} ${number(plate.size.heightMm)}"><rect width="100%" height="100%" fill="white"/>${body}</svg>`;
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
      const lineHeightMm = fontSizeMm * 1.2;
      const centerY = element.yMm + element.heightMm / 2;
      const firstLineY = centerY - ((lines.length - 1) * lineHeightMm) / 2;
      const tspans = lines
        .map(
          (line, index) =>
            `<tspan x="${number(x)}" y="${number(firstLineY + index * lineHeightMm)}">${line.length === 0 ? "&#160;" : text(line)}</tspan>`,
        )
        .join("");
      return `<text text-anchor="${anchor}" dominant-baseline="middle" font-family="${attribute(element.fontFamily)}" font-size="${number(fontSizeMm)}" font-weight="${element.fontWeight}" font-style="${element.fontStyle ?? "normal"}" fill="black"${transform}>${tspans}</text>`;
    }
    case "image": {
      if (
        !/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(element.source)
      ) {
        throw new TypeError("Only embedded raster images can be printed");
      }
      const aspect =
        element.fit === "stretch"
          ? "none"
          : element.fit === "cover"
            ? "xMidYMid slice"
            : "xMidYMid meet";
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
