import type {
  ImageEditorSource,
  ImageElement,
  LabelPlate,
} from "@labelmaker/domain";

import type { PrintableMargins } from "./label-layout.js";
import { newElementFrame } from "./new-element-frame.js";

export interface PixelBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CroppedDrawingPixels {
  readonly bounds: PixelBounds;
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface DrawingImageResult {
  readonly source: string;
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly originalWidthPixels: number;
  readonly originalHeightPixels: number;
  readonly bounds: PixelBounds;
  readonly editorSource: DrawingEditorSource;
}

export type DrawingEditorSource = ImageEditorSource;

const drawingEditorSources = new Map<
  string,
  Map<string, DrawingEditorSource>
>();

export function rememberDrawingEditorSource(
  elementId: string,
  croppedSource: string,
  editorSource: DrawingEditorSource,
): void {
  const elementSources = drawingEditorSources.get(elementId);
  if (elementSources) {
    elementSources.set(croppedSource, editorSource);
  } else {
    drawingEditorSources.set(
      elementId,
      new Map([[croppedSource, editorSource]]),
    );
  }
}

const pixelIsVisible = (data: Uint8ClampedArray, offset: number): boolean =>
  data[offset + 3]! > 0 &&
  (data[offset]! !== 255 ||
    data[offset + 1]! !== 255 ||
    data[offset + 2]! !== 255);

export function findVisiblePixelBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): PixelBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!pixelIsVisible(data, (y * width + x) * 4)) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top ? null : { left, top, right, bottom };
}

export function cropDrawingPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CroppedDrawingPixels | null {
  const bounds = findVisiblePixelBounds(data, width, height);
  if (!bounds) return null;
  const croppedWidth = bounds.right - bounds.left + 1;
  const croppedHeight = bounds.bottom - bounds.top + 1;
  const output = new Uint8ClampedArray(croppedWidth * croppedHeight * 4);
  for (let y = 0; y < croppedHeight; y += 1) {
    for (let x = 0; x < croppedWidth; x += 1) {
      const sourceOffset = ((bounds.top + y) * width + bounds.left + x) * 4;
      const outputOffset = (y * croppedWidth + x) * 4;
      const visible = pixelIsVisible(data, sourceOffset);
      output[outputOffset] = data[sourceOffset]!;
      output[outputOffset + 1] = data[sourceOffset + 1]!;
      output[outputOffset + 2] = data[sourceOffset + 2]!;
      output[outputOffset + 3] = visible ? data[sourceOffset + 3]! : 0;
    }
  }
  return {
    bounds,
    width: croppedWidth,
    height: croppedHeight,
    data: output,
  };
}

export function drawingResultFromCanvas(
  canvas: HTMLCanvasElement,
): DrawingImageResult | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The drawing canvas is not available.");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const cropped = cropDrawingPixels(pixels.data, canvas.width, canvas.height);
  if (!cropped) return null;
  const output = globalThis.document.createElement("canvas");
  output.width = cropped.width;
  output.height = cropped.height;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("The drawing canvas is not available.");
  const outputPixels = outputContext.createImageData(
    cropped.width,
    cropped.height,
  );
  outputPixels.data.set(cropped.data);
  outputContext.putImageData(outputPixels, 0, 0);
  const editorSource = canvas.toDataURL("image/png");
  const source = output.toDataURL("image/png");
  const fullEditorSource = {
    source: editorSource,
    widthPixels: canvas.width,
    heightPixels: canvas.height,
    bounds: cropped.bounds,
  };
  return {
    source,
    widthPixels: cropped.width,
    heightPixels: cropped.height,
    originalWidthPixels: canvas.width,
    originalHeightPixels: canvas.height,
    bounds: cropped.bounds,
    editorSource: fullEditorSource,
  };
}

export function drawingResultFromImageSource(
  source: string,
): Promise<DrawingImageResult | null> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(
        1,
        2048 / Math.max(1, image.naturalWidth),
        2048 / Math.max(1, image.naturalHeight),
      );
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("The image canvas is not available."));
        return;
      }
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        resolve(drawingResultFromCanvas(canvas));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error("The image could not open."));
    image.src = source;
  });
}

export function fitNewImageFrame(
  element: ImageElement,
  plate: LabelPlate,
  widthPixels: number,
  heightPixels: number,
  printableMargins?: PrintableMargins,
): ImageElement {
  const aspectRatio = Math.max(1, widthPixels) / Math.max(1, heightPixels);
  const printableFrame = newElementFrame(plate, 1, printableMargins);
  const frame = newElementFrame(
    plate,
    printableFrame.heightMm * aspectRatio,
    printableMargins,
  );
  return {
    ...element,
    ...frame,
    fit: "stretch",
  };
}

export function frameForCroppedImage(
  element: ImageElement,
  result: DrawingImageResult,
): ImageElement {
  const sourceWidth = Math.max(1, result.originalWidthPixels);
  const sourceHeight = Math.max(1, result.originalHeightPixels);
  const widthMm = element.widthMm * (result.widthPixels / sourceWidth);
  const heightMm = element.heightMm * (result.heightPixels / sourceHeight);
  const localCenterX =
    ((result.bounds.left + result.bounds.right + 1) / 2 / sourceWidth - 0.5) *
    element.widthMm;
  const localCenterY =
    ((result.bounds.top + result.bounds.bottom + 1) / 2 / sourceHeight - 0.5) *
    element.heightMm;
  const radians = (element.rotationDeg * Math.PI) / 180;
  const centerX = element.xMm + element.widthMm / 2;
  const centerY = element.yMm + element.heightMm / 2;
  const rotatedCenterX =
    centerX +
    localCenterX * Math.cos(radians) -
    localCenterY * Math.sin(radians);
  const rotatedCenterY =
    centerY +
    localCenterX * Math.sin(radians) +
    localCenterY * Math.cos(radians);
  return {
    ...element,
    source: result.source,
    editorSource: result.editorSource,
    fit: "stretch",
    xMm: rotatedCenterX - widthMm / 2,
    yMm: rotatedCenterY - heightMm / 2,
    widthMm,
    heightMm,
  };
}

export function frameForDrawingEditor(element: ImageElement): ImageElement {
  const editorSource =
    element.editorSource ??
    drawingEditorSources.get(element.id)?.get(element.source);
  if (!editorSource) return element;
  const croppedWidth = editorSource.bounds.right - editorSource.bounds.left + 1;
  const croppedHeight =
    editorSource.bounds.bottom - editorSource.bounds.top + 1;
  const sourceWidth = Math.max(1, editorSource.widthPixels);
  const sourceHeight = Math.max(1, editorSource.heightPixels);
  const widthMm = element.widthMm * (sourceWidth / Math.max(1, croppedWidth));
  const heightMm =
    element.heightMm * (sourceHeight / Math.max(1, croppedHeight));
  const localCenterX =
    ((editorSource.bounds.left + editorSource.bounds.right + 1) /
      2 /
      sourceWidth -
      0.5) *
    widthMm;
  const localCenterY =
    ((editorSource.bounds.top + editorSource.bounds.bottom + 1) /
      2 /
      sourceHeight -
      0.5) *
    heightMm;
  const radians = (element.rotationDeg * Math.PI) / 180;
  const croppedCenterX = element.xMm + element.widthMm / 2;
  const croppedCenterY = element.yMm + element.heightMm / 2;
  const centerX =
    croppedCenterX -
    localCenterX * Math.cos(radians) +
    localCenterY * Math.sin(radians);
  const centerY =
    croppedCenterY -
    localCenterX * Math.sin(radians) -
    localCenterY * Math.cos(radians);
  return {
    ...element,
    source: editorSource.source,
    xMm: centerX - widthMm / 2,
    yMm: centerY - heightMm / 2,
    widthMm,
    heightMm,
  };
}
