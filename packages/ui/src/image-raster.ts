import type { ImageElement } from "@labelmaker/domain";
import { rgbaToMonochrome, type MonochromeBitmap } from "@labelmaker/rendering";

const LABEL_PAPER_RED = 255;
const LABEL_PAPER_GREEN = 254;
const LABEL_PAPER_BLUE = 250;

export function monochromeImagePixels(
  monochrome: MonochromeBitmap,
  transparentBackground: boolean,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(
    monochrome.widthPixels * monochrome.heightPixels * 4,
  );
  monochrome.pixels.forEach((pixel, index) => {
    const offset = index * 4;
    if (pixel === 1) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 255;
      return;
    }
    output[offset] = LABEL_PAPER_RED;
    output[offset + 1] = LABEL_PAPER_GREEN;
    output[offset + 2] = LABEL_PAPER_BLUE;
    output[offset + 3] = transparentBackground ? 0 : 255;
  });
  return output;
}

function loadRasterImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = source;
  });
}

function drawFittedImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource & {
    readonly width: number;
    readonly height: number;
  },
  width: number,
  height: number,
  fit: ImageElement["fit"],
): void {
  if (fit === "stretch") {
    context.drawImage(image, 0, 0, width, height);
    return;
  }
  const scale =
    fit === "cover"
      ? Math.max(width / image.width, height / image.height)
      : Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

export async function renderMonochromeImageFrame(
  element: Pick<
    ImageElement,
    "source" | "fit" | "brightness" | "contrast" | "transparentBackground"
  >,
  widthPixels: number,
  heightPixels: number,
): Promise<HTMLCanvasElement> {
  const width = Math.max(1, Math.round(widthPixels));
  const height = Math.max(1, Math.round(heightPixels));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The image canvas is not available.");
  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);
  const image = await loadRasterImage(element.source);
  drawFittedImage(context, image, width, height, element.fit);
  const rgba = context.getImageData(0, 0, width, height);
  const monochrome = rgbaToMonochrome(
    { widthPixels: width, heightPixels: height, data: rgba.data },
    {
      brightness: element.brightness,
      contrast: element.contrast,
      mode: "floyd-steinberg",
      threshold: 128,
    },
  );
  const output = context.createImageData(width, height);
  output.data.set(
    monochromeImagePixels(monochrome, element.transparentBackground !== false),
  );
  context.putImageData(output, 0, 0);
  return canvas;
}
