import { describe, expect, it } from "vitest";

import {
  cropDrawingPixels,
  findVisiblePixelBounds,
  fitNewImageFrame,
  frameForCroppedImage,
  frameForDrawingEditor,
  rememberDrawingEditorSource,
  type DrawingImageResult,
} from "./drawing-image.js";

const whitePixels = (width: number, height: number) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  return data;
};

const setPixel = (
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  value: number,
) => {
  const offset = (y * width + x) * 4;
  data[offset] = value;
  data[offset + 1] = value;
  data[offset + 2] = value;
  data[offset + 3] = 255;
};

describe("drawing image bounds", () => {
  it("treats white and transparent pixels as empty", () => {
    const data = whitePixels(3, 2);
    data[3] = 0;
    expect(findVisiblePixelBounds(data, 3, 2)).toBeNull();
  });

  it("keeps a near-white pixel inside the drawing bounds", () => {
    const data = whitePixels(3, 2);
    setPixel(data, 3, 2, 1, 254);

    expect(findVisiblePixelBounds(data, 3, 2)).toEqual({
      left: 2,
      top: 1,
      right: 2,
      bottom: 1,
    });
  });

  it("crops to the first and last visible pixels", () => {
    const data = whitePixels(4, 3);
    setPixel(data, 4, 1, 0, 0);
    setPixel(data, 4, 2, 2, 120);

    const cropped = cropDrawingPixels(data, 4, 3);

    expect(cropped).toMatchObject({
      bounds: { left: 1, top: 0, right: 2, bottom: 2 },
      width: 2,
      height: 3,
    });
    expect(cropped?.data[(1 * 2 + 1) * 4 + 3]).toBe(0);
    expect(cropped?.data[(2 * 2 + 1) * 4 + 3]).toBe(255);
  });
});

describe("drawing image frames", () => {
  const image = {
    id: "image",
    kind: "image" as const,
    xMm: 10,
    yMm: 20,
    widthMm: 40,
    heightMm: 20,
    rotationDeg: 0,
    source: "old",
    fit: "contain" as const,
    brightness: 128,
    contrast: 128,
  };

  it("keeps the cropped pixels in their current physical position", () => {
    const result: DrawingImageResult = {
      source: "new",
      widthPixels: 50,
      heightPixels: 30,
      originalWidthPixels: 100,
      originalHeightPixels: 50,
      bounds: { left: 25, top: 10, right: 74, bottom: 39 },
      editorSource: {
        source: "full",
        widthPixels: 100,
        heightPixels: 50,
        bounds: { left: 25, top: 10, right: 74, bottom: 39 },
      },
    };

    expect(frameForCroppedImage(image, result)).toMatchObject({
      source: "new",
      fit: "stretch",
      xMm: 20,
      yMm: 24,
      widthMm: 20,
      heightMm: 12,
    });
  });

  it("restores the full editor frame for each crop cycle", () => {
    rememberDrawingEditorSource("image", "cropped", {
      source: "full",
      widthPixels: 100,
      heightPixels: 50,
      bounds: { left: 25, top: 10, right: 74, bottom: 39 },
    });
    const cropped = {
      ...image,
      source: "cropped",
      xMm: 20,
      yMm: 24,
      widthMm: 20,
      heightMm: 12,
    };

    const restored = frameForDrawingEditor(cropped);
    const croppedAgain = frameForCroppedImage(restored, {
      source: "cropped-again",
      widthPixels: 50,
      heightPixels: 30,
      originalWidthPixels: 100,
      originalHeightPixels: 50,
      bounds: { left: 25, top: 10, right: 74, bottom: 39 },
      editorSource: {
        source: "full-again",
        widthPixels: 100,
        heightPixels: 50,
        bounds: { left: 25, top: 10, right: 74, bottom: 39 },
      },
    });

    expect(restored).toMatchObject({
      source: "full",
      xMm: 10,
      yMm: 20,
      widthMm: 40,
      heightMm: 20,
    });
    expect(croppedAgain).toMatchObject({
      source: "cropped-again",
      fit: "stretch",
      xMm: cropped.xMm,
      yMm: cropped.yMm,
      widthMm: cropped.widthMm,
      heightMm: cropped.heightMm,
    });
    rememberDrawingEditorSource("image", "cropped-again", {
      source: "full-again",
      widthPixels: 100,
      heightPixels: 50,
      bounds: { left: 25, top: 10, right: 74, bottom: 39 },
    });
    expect(frameForDrawingEditor(croppedAgain)).toMatchObject({
      source: "full-again",
      xMm: restored.xMm,
      yMm: restored.yMm,
      widthMm: restored.widthMm,
      heightMm: restored.heightMm,
    });
    expect(frameForDrawingEditor(cropped).source).toBe("full");
  });

  it("restores a full editor frame from persisted image metadata", () => {
    const cropped = frameForCroppedImage(
      { ...image, id: "persisted-image" },
      {
        source: "persisted-crop",
        widthPixels: 50,
        heightPixels: 30,
        originalWidthPixels: 100,
        originalHeightPixels: 50,
        bounds: { left: 25, top: 10, right: 74, bottom: 39 },
        editorSource: {
          source: "persisted-full",
          widthPixels: 100,
          heightPixels: 50,
          bounds: { left: 25, top: 10, right: 74, bottom: 39 },
        },
      },
    );

    expect(frameForDrawingEditor(structuredClone(cropped))).toMatchObject({
      source: "persisted-full",
      xMm: image.xMm,
      yMm: image.yMm,
      widthMm: image.widthMm,
      heightMm: image.heightMm,
    });
  });

  it("restores an offset crop in a rotated full editor frame", () => {
    rememberDrawingEditorSource("image", "rotated-crop", {
      source: "rotated-full",
      widthPixels: 100,
      heightPixels: 50,
      bounds: { left: 10, top: 5, right: 39, bottom: 14 },
    });
    const cropped = {
      ...image,
      source: "rotated-crop",
      xMm: 30,
      yMm: 18,
      widthMm: 12,
      heightMm: 4,
      rotationDeg: 90,
    };

    const restored = frameForDrawingEditor(cropped);

    expect(restored).toMatchObject({
      source: "rotated-full",
      xMm: 10,
      yMm: 20,
      widthMm: 40,
      heightMm: 20,
      rotationDeg: 90,
    });
    expect(
      frameForCroppedImage(restored, {
        source: "rotated-crop-again",
        widthPixels: 30,
        heightPixels: 10,
        originalWidthPixels: 100,
        originalHeightPixels: 50,
        bounds: { left: 10, top: 5, right: 39, bottom: 14 },
        editorSource: {
          source: "rotated-full-again",
          widthPixels: 100,
          heightPixels: 50,
          bounds: { left: 10, top: 5, right: 39, bottom: 14 },
        },
      }),
    ).toMatchObject({
      xMm: cropped.xMm,
      yMm: cropped.yMm,
      widthMm: cropped.widthMm,
      heightMm: cropped.heightMm,
      rotationDeg: 90,
    });
  });

  it("keeps separate full canvases for identical cropped image data", () => {
    const first = { ...image, id: "first", source: "same-crop" };
    const second = { ...image, id: "second", source: "same-crop" };
    rememberDrawingEditorSource(first.id, first.source, {
      source: "first-full",
      widthPixels: 100,
      heightPixels: 50,
      bounds: { left: 25, top: 10, right: 74, bottom: 39 },
    });
    rememberDrawingEditorSource(second.id, second.source, {
      source: "second-full",
      widthPixels: 80,
      heightPixels: 40,
      bounds: { left: 15, top: 5, right: 64, bottom: 34 },
    });

    expect(frameForDrawingEditor(first).source).toBe("first-full");
    expect(frameForDrawingEditor(second).source).toBe("second-full");
    expect(
      frameForDrawingEditor({ ...first, source: "changed-crop" }),
    ).toMatchObject({ source: "changed-crop", widthMm: first.widthMm });
  });

  it("fits a new drawing without changing its pixel aspect", () => {
    const plate = {
      id: "plate",
      name: "Plate",
      size: { widthMm: 60, heightMm: 30 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [],
    };

    expect(
      fitNewImageFrame(image, plate, 100, 25, {
        topMm: 2,
        bottomMm: 3,
      }),
    ).toMatchObject({
      xMm: -20,
      yMm: 2,
      widthMm: 100,
      heightMm: 25,
      fit: "stretch",
    });
  });

  it("keeps an extreme source aspect inside the document size limit", () => {
    const plate = {
      id: "plate",
      name: "Plate",
      size: { widthMm: 60, heightMm: 30 },
      margins: { leftMm: 0, rightMm: 0 },
      elements: [],
    };

    expect(fitNewImageFrame(image, plate, 100_000, 1)).toMatchObject({
      xMm: -4_970,
      yMm: 0,
      widthMm: 10_000,
      heightMm: 30,
    });
  });
});
