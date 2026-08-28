import type { RasterPage } from "@labelmaker/printing";

export const MILLIMETERS_PER_INCH = 25.4;

/**
 * A cross-platform memory limit for one packed raster page. It also rejects
 * hostile dimensions before this package allocates an output buffer.
 */
export const MAX_RASTER_BYTES = 256 * 1024 * 1024;

/** Bound temporary luminance buffers as well as the packed result. */
export const MAX_RASTER_PIXELS = 4 * 1024 * 1024;

export interface PixelDimensions {
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface ValidatedRasterDimensions extends PixelDimensions {
  readonly bytesPerRow: number;
  readonly byteLength: number;
}

export interface PlateRasterPlanInput {
  readonly plateId?: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly dpi: number;
}

export interface PlateRasterPlan extends ValidatedRasterDimensions {
  readonly plateId?: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly dpi: number;
}

/** One byte per pixel: 1 is black and 0 is white. */
export interface MonochromeBitmap extends PixelDimensions {
  readonly pixels: Uint8Array;
}

/** RGBA bytes in row-major order, as returned by browser ImageData. */
export interface RgbaImage extends PixelDimensions {
  readonly data: Uint8Array | Uint8ClampedArray;
}

export type MonochromeMode = "threshold" | "floyd-steinberg";

export interface MonochromeOptions {
  readonly mode?: MonochromeMode;
  /** A composited luminance below this value becomes black. */
  readonly threshold?: number;
  /** Midtone level from 0 through 255. 128 is neutral; higher is darker. */
  readonly blackLevel?: number;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number.`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function checkedProduct(left: number, right: number, name: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} exceeds the supported integer range.`);
  }
  return result;
}

/** Convert a non-negative physical distance to the nearest device pixel. */
export function millimetersToPixels(millimeters: number, dpi: number): number {
  assertFiniteNumber(millimeters, "millimeters");
  assertFiniteNumber(dpi, "dpi");
  if (millimeters < 0) {
    throw new RangeError("millimeters must not be negative.");
  }
  if (dpi <= 0) {
    throw new RangeError("dpi must be greater than zero.");
  }

  const pixels = Math.round((millimeters * dpi) / MILLIMETERS_PER_INCH);
  if (!Number.isSafeInteger(pixels)) {
    throw new RangeError(
      "The converted pixel value is outside the safe range.",
    );
  }
  return pixels;
}

/** Validate dimensions and calculate the canonical packed row layout. */
export function validateRasterDimensions(
  widthPixels: number,
  heightPixels: number,
): ValidatedRasterDimensions {
  assertPositiveInteger(widthPixels, "widthPixels");
  assertPositiveInteger(heightPixels, "heightPixels");

  const pixelCount = checkedProduct(
    widthPixels,
    heightPixels,
    "Raster pixel count",
  );
  if (pixelCount > MAX_RASTER_PIXELS) {
    throw new RangeError(
      `Raster pixel count must not exceed ${MAX_RASTER_PIXELS} pixels.`,
    );
  }

  const bytesPerRow = Math.ceil(widthPixels / 8);
  const byteLength = checkedProduct(
    bytesPerRow,
    heightPixels,
    "Packed raster byte length",
  );
  if (byteLength > MAX_RASTER_BYTES) {
    throw new RangeError(
      `Packed raster byte length must not exceed ${MAX_RASTER_BYTES} bytes.`,
    );
  }

  return { widthPixels, heightPixels, bytesPerRow, byteLength };
}

/** Resolve a physical plate size into the exact canvas size to render. */
export function createPlateRasterPlan(
  input: PlateRasterPlanInput,
): PlateRasterPlan {
  assertFiniteNumber(input.widthMm, "widthMm");
  assertFiniteNumber(input.heightMm, "heightMm");
  if (input.widthMm <= 0 || input.heightMm <= 0) {
    throw new RangeError("Plate width and height must be greater than zero.");
  }

  const widthPixels = millimetersToPixels(input.widthMm, input.dpi);
  const heightPixels = millimetersToPixels(input.heightMm, input.dpi);
  const dimensions = validateRasterDimensions(widthPixels, heightPixels);
  const shared = {
    ...dimensions,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    dpi: input.dpi,
  };

  return input.plateId === undefined
    ? shared
    : { ...shared, plateId: input.plateId };
}

function validateRgbaImage(image: RgbaImage): void {
  const { widthPixels, heightPixels } = validateRasterDimensions(
    image.widthPixels,
    image.heightPixels,
  );
  const pixelCount = checkedProduct(
    widthPixels,
    heightPixels,
    "RGBA pixel count",
  );
  const expectedLength = checkedProduct(pixelCount, 4, "RGBA byte length");
  if (
    !(image.data instanceof Uint8Array) &&
    !(image.data instanceof Uint8ClampedArray)
  ) {
    throw new TypeError("RGBA data must be a Uint8Array or Uint8ClampedArray.");
  }
  if (image.data.length !== expectedLength) {
    throw new RangeError(
      `RGBA data length must be ${expectedLength}; received ${image.data.length}.`,
    );
  }
}

function resolveThreshold(value: number | undefined): number {
  const threshold = value ?? 128;
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
    throw new RangeError("threshold must be an integer from 0 through 255.");
  }
  return threshold;
}

function resolveBlackLevel(value: number | undefined): number {
  const blackLevel = value ?? 128;
  if (!Number.isInteger(blackLevel) || blackLevel < 0 || blackLevel > 255) {
    throw new RangeError("blackLevel must be an integer from 0 through 255.");
  }
  return blackLevel;
}

function resolveMode(mode: MonochromeMode | undefined): MonochromeMode {
  if (mode === undefined || mode === "threshold") {
    return "threshold";
  }
  if (mode === "floyd-steinberg") {
    return mode;
  }
  throw new RangeError(`Unsupported monochrome mode: ${String(mode)}.`);
}

function compositedLuminance(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): number {
  const luminance = (299 * red + 587 * green + 114 * blue) / 1000;
  return (luminance * alpha + 255 * (255 - alpha)) / 255;
}

function applyBlackLevel(luminance: number, blackLevel: number): number {
  if (luminance <= 0 || luminance >= 255 || blackLevel === 128) {
    return luminance;
  }
  const gamma = 2 ** ((blackLevel - 128) / 64);
  return 255 * (luminance / 255) ** gamma;
}

function rgbaLuminances(image: RgbaImage, blackLevel: number): Float64Array {
  const count = image.widthPixels * image.heightPixels;
  const luminances = new Float64Array(count);
  for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    luminances[pixelIndex] = applyBlackLevel(
      compositedLuminance(
        image.data[rgbaIndex] ?? 0,
        image.data[rgbaIndex + 1] ?? 0,
        image.data[rgbaIndex + 2] ?? 0,
        image.data[rgbaIndex + 3] ?? 0,
      ),
      blackLevel,
    );
  }
  return luminances;
}

function thresholdLuminances(
  luminances: Float64Array,
  threshold: number,
): Uint8Array {
  const pixels = new Uint8Array(luminances.length);
  for (let index = 0; index < luminances.length; index += 1) {
    pixels[index] = (luminances[index] ?? 255) < threshold ? 1 : 0;
  }
  return pixels;
}

function ditherLuminances(
  luminances: Float64Array,
  widthPixels: number,
  heightPixels: number,
  threshold: number,
): Uint8Array {
  const pixels = new Uint8Array(luminances.length);

  for (let y = 0; y < heightPixels; y += 1) {
    for (let x = 0; x < widthPixels; x += 1) {
      const index = y * widthPixels + x;
      const oldValue = luminances[index] ?? 255;
      const isBlack = oldValue < threshold;
      const newValue = isBlack ? 0 : 255;
      pixels[index] = isBlack ? 1 : 0;
      const error = oldValue - newValue;

      if (x + 1 < widthPixels) {
        luminances[index + 1] =
          (luminances[index + 1] ?? 255) + error * (7 / 16);
      }
      if (y + 1 >= heightPixels) {
        continue;
      }
      const nextRow = index + widthPixels;
      if (x > 0) {
        luminances[nextRow - 1] =
          (luminances[nextRow - 1] ?? 255) + error * (3 / 16);
      }
      luminances[nextRow] = (luminances[nextRow] ?? 255) + error * (5 / 16);
      if (x + 1 < widthPixels) {
        luminances[nextRow + 1] =
          (luminances[nextRow + 1] ?? 255) + error * (1 / 16);
      }
    }
  }

  return pixels;
}

/** Composite RGBA on white, then threshold or dither it to one byte per pixel. */
export function rgbaToMonochrome(
  image: RgbaImage,
  options: MonochromeOptions = {},
): MonochromeBitmap {
  validateRgbaImage(image);
  const threshold = resolveThreshold(options.threshold);
  const blackLevel = resolveBlackLevel(options.blackLevel);
  const mode = resolveMode(options.mode);
  const luminances = rgbaLuminances(image, blackLevel);
  const pixels =
    mode === "threshold"
      ? thresholdLuminances(luminances, threshold)
      : ditherLuminances(
          luminances,
          image.widthPixels,
          image.heightPixels,
          threshold,
        );

  return {
    widthPixels: image.widthPixels,
    heightPixels: image.heightPixels,
    pixels,
  };
}

/** Pack a one-byte-per-pixel bitmap into the canonical RasterPage format. */
export function packMonochromeRows(bitmap: MonochromeBitmap): RasterPage {
  const dimensions = validateRasterDimensions(
    bitmap.widthPixels,
    bitmap.heightPixels,
  );
  const pixelCount = checkedProduct(
    bitmap.widthPixels,
    bitmap.heightPixels,
    "Monochrome pixel count",
  );
  if (!(bitmap.pixels instanceof Uint8Array)) {
    throw new TypeError("Monochrome pixels must be a Uint8Array.");
  }
  if (bitmap.pixels.length !== pixelCount) {
    throw new RangeError(
      `Monochrome pixel length must be ${pixelCount}; received ${bitmap.pixels.length}.`,
    );
  }

  const data = new Uint8Array(dimensions.byteLength);
  for (let y = 0; y < bitmap.heightPixels; y += 1) {
    for (let x = 0; x < bitmap.widthPixels; x += 1) {
      const pixel = bitmap.pixels[y * bitmap.widthPixels + x];
      if (pixel !== 0 && pixel !== 1) {
        throw new RangeError("Monochrome pixels must contain only 0 or 1.");
      }
      if (pixel === 1) {
        const byteIndex = y * dimensions.bytesPerRow + Math.floor(x / 8);
        data[byteIndex] = (data[byteIndex] ?? 0) | (0x80 >> (x % 8));
      }
    }
  }

  return {
    widthPixels: bitmap.widthPixels,
    heightPixels: bitmap.heightPixels,
    bytesPerRow: dimensions.bytesPerRow,
    data,
  };
}

/** Convert RGBA pixels directly into a canonical packed raster page. */
export function renderRgbaToRasterPage(
  image: RgbaImage,
  options: MonochromeOptions = {},
): RasterPage {
  return packMonochromeRows(rgbaToMonochrome(image, options));
}

/** Render pixels for a physical plate and reject a canvas at the wrong size. */
export function renderPlateRgba(
  plan: PlateRasterPlan,
  image: RgbaImage,
  options: MonochromeOptions = {},
): RasterPage {
  validateRasterDimensions(plan.widthPixels, plan.heightPixels);
  if (
    image.widthPixels !== plan.widthPixels ||
    image.heightPixels !== plan.heightPixels
  ) {
    throw new RangeError(
      `RGBA dimensions must match the plate plan (${plan.widthPixels}x${plan.heightPixels}).`,
    );
  }
  return renderRgbaToRasterPage(image, options);
}
