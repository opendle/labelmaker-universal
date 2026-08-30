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

export type ImageRasterizer = (
  image: ImageElement,
  widthPixels: number,
  heightPixels: number,
) => RgbaImage | Promise<RgbaImage>;

/** Render a plate and transpose it into head-line order for printer adapters. */
export async function renderPlateForPrinter(
  plate: LabelPlate,
  target: PlateRasterTarget,
  rasterize: SvgRasterizer,
  rasterizeImage?: ImageRasterizer,
): Promise<RasterPage> {
  if (
    !Number.isSafeInteger(target.rasterWidthPixels) ||
    target.rasterWidthPixels < 1
  ) {
    throw new RangeError("Printer raster width must be a positive integer");
  }
  const feedLengthPixels = millimetersToPixels(plate.size.widthMm, target.dpi);
  const preparedPlate = await preparePlateImages(
    plate,
    target.dpi,
    rasterize,
    rasterizeImage,
  );
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
  rasterizeImage?: ImageRasterizer,
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
    const source = rasterizeImage
      ? await rasterizeImage(element, width, height)
      : await rasterize(
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
      source: monochromePngDataUrl(
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

function monochromePngDataUrl(
  bitmap: MonochromeBitmap,
  transparentBackground: boolean,
): string {
  // WebKit does not reliably decode an embedded BMP when it rasterizes an SVG.
  // Use a portable indexed PNG so mobile and desktop shells get the same image.
  const scanlineBytes = 1 + bitmap.widthPixels;
  const imageBytes = new Uint8Array(scanlineBytes * bitmap.heightPixels);
  for (let y = 0; y < bitmap.heightPixels; y += 1) {
    const rowOffset = y * scanlineBytes;
    imageBytes[rowOffset] = 0;
    for (let x = 0; x < bitmap.widthPixels; x += 1) {
      const black = bitmap.pixels[y * bitmap.widthPixels + x] === 1;
      imageBytes[rowOffset + 1 + x] = black ? 0 : 1;
    }
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, bitmap.widthPixels);
  headerView.setUint32(4, bitmap.heightPixels);
  header[8] = 8;
  header[9] = 3;
  const bytes = concatenateBytes(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk("IHDR", header),
    pngChunk("PLTE", Uint8Array.of(0, 0, 0, 255, 255, 255)),
    pngChunk("tRNS", Uint8Array.of(255, transparentBackground ? 0 : 255)),
    pngChunk("IDAT", uncompressedZlib(imageBytes)),
    pngChunk("IEND", new Uint8Array()),
  );
  return `data:image/png;base64,${encodeBase64(bytes)}`;
}

function uncompressedZlib(bytes: Uint8Array): Uint8Array {
  const blockCount = Math.ceil(bytes.length / 65_535);
  const output = new Uint8Array(2 + blockCount * 5 + bytes.length + 4);
  output[0] = 0x78;
  output[1] = 0x01;
  let sourceOffset = 0;
  let outputOffset = 2;
  while (sourceOffset < bytes.length) {
    const length = Math.min(65_535, bytes.length - sourceOffset);
    output[outputOffset] = sourceOffset + length === bytes.length ? 1 : 0;
    output[outputOffset + 1] = length & 0xff;
    output[outputOffset + 2] = length >>> 8;
    const inverseLength = 0xffff - length;
    output[outputOffset + 3] = inverseLength & 0xff;
    output[outputOffset + 4] = inverseLength >>> 8;
    output.set(
      bytes.subarray(sourceOffset, sourceOffset + length),
      outputOffset + 5,
    );
    sourceOffset += length;
    outputOffset += length + 5;
  }
  new DataView(output.buffer).setUint32(outputOffset, adler32(bytes));
  return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) =>
    character.charCodeAt(0),
  );
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(concatenateBytes(typeBytes, data)));
  return chunk;
}

function concatenateBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function adler32(bytes: Uint8Array): number {
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  return ((second << 16) | first) >>> 0;
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = (value >>> 8) ^ (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0);
  }
  return (value ^ 0xffffffff) >>> 0;
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
            `<tspan x="${number(x)}" y="${number(firstLineY + index * lineHeightMm)}" dominant-baseline="central">${line.length === 0 ? "&#160;" : text(line)}</tspan>`,
        )
        .join("");
      return `<text text-anchor="${anchor}" font-family="${attribute(element.fontFamily)}" font-size="${number(fontSizeMm)}" font-weight="${element.fontWeight}" font-style="${element.fontStyle ?? "normal"}" fill="black"${transform}>${tspans}</text>`;
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
