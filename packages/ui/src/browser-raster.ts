import type { LabelElement, LabelPlate, TextElement } from "@labelmaker/domain";
import { rgbaToMonochrome } from "@labelmaker/rendering";

import { renderMonochromeImageFrame } from "./image-raster.js";
import { pointsToMillimeters } from "./label-layout.js";

export interface BlackPixelBounds {
  readonly minX: number;
  readonly maxX: number;
}

const PIXELS_PER_MILLIMETER = 8;

function textFont(element: TextElement): string {
  return `${element.fontStyle ?? "normal"} ${element.fontWeight} ${pointsToMillimeters(element.fontSizePt) * PIXELS_PER_MILLIMETER}px ${element.fontFamily}`;
}

function rotatedHorizontalBounds(
  element: LabelElement,
  left: number,
  right: number,
  top: number,
  bottom: number,
): readonly [number, number] {
  if (element.rotationDeg === 0) return [left, right];
  const centerX = element.xMm + element.widthMm / 2;
  const centerY = element.yMm + element.heightMm / 2;
  const radians = (element.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const xValues = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(
    ([x = 0, y = 0]) => centerX + (x - centerX) * cosine - (y - centerY) * sine,
  );
  return [Math.min(...xValues), Math.max(...xValues)];
}

function plateRenderExtent(
  plate: LabelPlate,
  context: CanvasRenderingContext2D,
): readonly [number, number] {
  let minX = 0;
  let maxX = plate.size.widthMm;
  for (const element of plate.elements) {
    if (element.kind === "text") {
      context.font = textFont(element);
      const lines = element.text.split(/\r\n?|\n/);
      const lineHeightMm = pointsToMillimeters(
        element.lineHeightPt ?? element.fontSizePt,
      );
      const topMm = textBlockTop(element, lines.length);
      const anchorX =
        element.align === "left"
          ? element.xMm
          : element.align === "right"
            ? element.xMm + element.widthMm
            : element.xMm + element.widthMm / 2;
      for (const [index, line] of lines.entries()) {
        context.textAlign = element.align;
        const metrics = context.measureText(line);
        const fallbackLeft =
          element.align === "left"
            ? 0
            : element.align === "right"
              ? metrics.width
              : metrics.width / 2;
        const fallbackRight = metrics.width - fallbackLeft;
        const left =
          anchorX -
          (metrics.actualBoundingBoxLeft || fallbackLeft) /
            PIXELS_PER_MILLIMETER;
        const right =
          anchorX +
          (metrics.actualBoundingBoxRight || fallbackRight) /
            PIXELS_PER_MILLIMETER;
        const centerY = topMm + (index + 0.5) * lineHeightMm;
        const bounds = rotatedHorizontalBounds(
          element,
          left,
          right,
          centerY - lineHeightMm / 2,
          centerY + lineHeightMm / 2,
        );
        minX = Math.min(minX, bounds[0]);
        maxX = Math.max(maxX, bounds[1]);
      }
      continue;
    }
    const stroke = element.kind === "rectangle" ? element.strokeWidthMm / 2 : 0;
    const bounds = rotatedHorizontalBounds(
      element,
      element.xMm - stroke,
      element.xMm + element.widthMm + stroke,
      element.yMm - stroke,
      element.yMm + element.heightMm + stroke,
    );
    minX = Math.min(minX, bounds[0]);
    maxX = Math.max(maxX, bounds[1]);
  }
  return [
    Math.floor(minX * PIXELS_PER_MILLIMETER) / PIXELS_PER_MILLIMETER,
    Math.ceil(maxX * PIXELS_PER_MILLIMETER) / PIXELS_PER_MILLIMETER,
  ];
}

function textBlockTop(element: TextElement, lineCount: number): number {
  const lineHeightMm = pointsToMillimeters(
    element.lineHeightPt ?? element.fontSizePt,
  );
  const blockHeightMm = lineCount * lineHeightMm;
  if ((element.verticalAlign ?? "middle") === "top") return element.yMm;
  if (element.verticalAlign === "bottom") {
    return element.yMm + element.heightMm - blockHeightMm;
  }
  return element.yMm + (element.heightMm - blockHeightMm) / 2;
}

export async function renderPlateBlackBounds(
  plate: LabelPlate,
): Promise<BlackPixelBounds | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const measurementContext = canvas.getContext("2d");
  if (!measurementContext) throw new Error("The trim canvas is not available.");
  const [renderMinX, renderMaxX] = plateRenderExtent(plate, measurementContext);
  const width = Math.max(
    1,
    Math.round((renderMaxX - renderMinX) * PIXELS_PER_MILLIMETER),
  );
  const height = Math.max(
    1,
    Math.round(plate.size.heightMm * PIXELS_PER_MILLIMETER),
  );
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The trim canvas is not available.");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  context.translate(-renderMinX * PIXELS_PER_MILLIMETER, 0);

  const imageFrames = new Map<string, HTMLCanvasElement>();
  await Promise.all(
    plate.elements.map(async (element) => {
      if (element.kind !== "image") return;
      imageFrames.set(
        element.id,
        await renderMonochromeImageFrame(
          element,
          element.widthMm * PIXELS_PER_MILLIMETER,
          element.heightMm * PIXELS_PER_MILLIMETER,
        ),
      );
    }),
  );

  for (const element of plate.elements) {
    const centerX = (element.xMm + element.widthMm / 2) * PIXELS_PER_MILLIMETER;
    const centerY =
      (element.yMm + element.heightMm / 2) * PIXELS_PER_MILLIMETER;
    context.save();
    context.translate(centerX, centerY);
    context.rotate((element.rotationDeg * Math.PI) / 180);
    context.translate(-centerX, -centerY);
    if (element.kind === "image") {
      const frame = imageFrames.get(element.id);
      if (!frame) throw new Error("The image frame could not be rendered.");
      context.drawImage(
        frame,
        element.xMm * PIXELS_PER_MILLIMETER,
        element.yMm * PIXELS_PER_MILLIMETER,
        element.widthMm * PIXELS_PER_MILLIMETER,
        element.heightMm * PIXELS_PER_MILLIMETER,
      );
    } else if (element.kind === "text") {
      const lines = element.text.split(/\r\n?|\n/);
      const lineHeightMm = pointsToMillimeters(
        element.lineHeightPt ?? element.fontSizePt,
      );
      const xMm =
        element.align === "left"
          ? element.xMm
          : element.align === "right"
            ? element.xMm + element.widthMm
            : element.xMm + element.widthMm / 2;
      context.fillStyle = "black";
      context.font = textFont(element);
      context.textAlign = element.align;
      context.textBaseline = "middle";
      const topMm = textBlockTop(element, lines.length);
      lines.forEach((line, index) =>
        context.fillText(
          line,
          xMm * PIXELS_PER_MILLIMETER,
          (topMm + (index + 0.5) * lineHeightMm) * PIXELS_PER_MILLIMETER,
        ),
      );
    } else if (element.kind === "rectangle") {
      const x = element.xMm * PIXELS_PER_MILLIMETER;
      const y = element.yMm * PIXELS_PER_MILLIMETER;
      const frameWidth = element.widthMm * PIXELS_PER_MILLIMETER;
      const frameHeight = element.heightMm * PIXELS_PER_MILLIMETER;
      context.fillStyle = "black";
      context.strokeStyle = "black";
      context.lineWidth = element.strokeWidthMm * PIXELS_PER_MILLIMETER;
      if (element.shapeType === "line") {
        context.beginPath();
        context.moveTo(x, y + frameHeight / 2);
        context.lineTo(x + frameWidth, y + frameHeight / 2);
        context.stroke();
      } else if (element.shapeType === "circle") {
        context.beginPath();
        context.ellipse(
          x + frameWidth / 2,
          y + frameHeight / 2,
          frameWidth / 2,
          frameHeight / 2,
          0,
          0,
          Math.PI * 2,
        );
        if (element.filled) context.fill();
        else context.stroke();
      } else if (element.filled)
        context.fillRect(x, y, frameWidth, frameHeight);
      else context.strokeRect(x, y, frameWidth, frameHeight);
    }
    context.restore();
  }

  const rgba = context.getImageData(0, 0, width, height);
  const monochrome = rgbaToMonochrome(
    { widthPixels: width, heightPixels: height, data: rgba.data },
    { mode: "floyd-steinberg", threshold: 160 },
  );
  let minPixel = width;
  let maxPixel = -1;
  monochrome.pixels.forEach((pixel, index) => {
    if (pixel !== 1) return;
    const x = index % width;
    minPixel = Math.min(minPixel, x);
    maxPixel = Math.max(maxPixel, x);
  });
  return maxPixel < 0
    ? null
    : {
        minX: renderMinX + minPixel / PIXELS_PER_MILLIMETER,
        maxX: renderMinX + (maxPixel + 1) / PIXELS_PER_MILLIMETER,
      };
}
