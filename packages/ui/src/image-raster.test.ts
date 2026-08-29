import { describe, expect, it } from "vitest";

import { monochromeImagePixels } from "./image-raster.js";

describe("monochrome image pixels", () => {
  const bitmap = {
    widthPixels: 2,
    heightPixels: 1,
    pixels: Uint8Array.from([1, 0]),
  };

  it("makes white pixels transparent when the image setting is enabled", () => {
    expect([...monochromeImagePixels(bitmap, true)]).toEqual([
      0, 0, 0, 255, 255, 254, 250, 0,
    ]);
  });

  it("uses the label paper color for an opaque image background", () => {
    expect([...monochromeImagePixels(bitmap, false)]).toEqual([
      0, 0, 0, 255, 255, 254, 250, 255,
    ]);
  });
});
