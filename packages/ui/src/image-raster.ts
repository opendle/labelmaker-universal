import type { ImageElement } from "@labelmaker/domain";
import { rgbaToMonochrome } from "@labelmaker/rendering";

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
  element: Pick<ImageElement, "source" | "fit" | "threshold">,
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
    { mode: "floyd-steinberg", threshold: element.threshold },
  );
  const output = context.createImageData(width, height);
  monochrome.pixels.forEach((pixel, index) => {
    const value = pixel === 1 ? 0 : 255;
    const offset = index * 4;
    output.data[offset] = value;
    output.data[offset + 1] = value;
    output.data[offset + 2] = value;
    output.data[offset + 3] = 255;
  });
  context.putImageData(output, 0, 0);
  return canvas;
}
