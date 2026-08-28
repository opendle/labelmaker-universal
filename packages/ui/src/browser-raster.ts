import type { LabelPlate, TextElement } from "@labelmaker/domain";
import { rgbaToMonochrome } from "@labelmaker/rendering";

import { renderMonochromeImageFrame } from "./image-raster.js";
import { pointsToMillimeters } from "./label-layout.js";

export interface BlackPixelBounds {
  readonly minX: number;
  readonly maxX: number;
}

const PIXELS_PER_MILLIMETER = 8;

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
  const width = Math.max(
    1,
    Math.round(plate.size.widthMm * PIXELS_PER_MILLIMETER),
  );
  const height = Math.max(
    1,
    Math.round(plate.size.heightMm * PIXELS_PER_MILLIMETER),
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The trim canvas is not available.");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);

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
      context.font = `${element.fontStyle ?? "normal"} ${element.fontWeight} ${pointsToMillimeters(element.fontSizePt) * PIXELS_PER_MILLIMETER}px ${element.fontFamily}`;
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
      if (element.filled) context.fillRect(x, y, frameWidth, frameHeight);
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
        minX: minPixel / PIXELS_PER_MILLIMETER,
        maxX: (maxPixel + 1) / PIXELS_PER_MILLIMETER,
      };
}
