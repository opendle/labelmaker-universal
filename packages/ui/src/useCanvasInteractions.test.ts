import type { TextElement } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";

import {
  resizeFrameFromDrag,
  type ResizeCorner,
} from "./useCanvasInteractions.js";

const element: TextElement = {
  id: "text",
  kind: "text",
  xMm: 4,
  yMm: 3,
  widthMm: 12,
  heightMm: 4,
  rotationDeg: 0,
  text: "TEXT",
  fontFamily: "sans-serif",
  fontSizePt: 12,
  fontWeight: 400,
  align: "left",
};
const plateSize = { widthMm: 40, heightMm: 16 };
const margins = { topMm: 2, bottomMm: 3 };
const noSnap = { xMm: 0, yMm: 0 };

const oppositeCorner = (corner: ResizeCorner, frame: TextElement) => ({
  x: corner.includes("w") ? frame.xMm + frame.widthMm : frame.xMm,
  y: corner.includes("n") ? frame.yMm + frame.heightMm : frame.yMm,
});

describe("proportional canvas resize", () => {
  it.each([
    ["nw", -6, -1],
    ["ne", 6, -1],
    ["sw", -6, 1],
    ["se", 6, 1],
  ] as const)(
    "preserves the starting ratio from the %s handle",
    (corner, dx, dy) => {
      const resized = resizeFrameFromDrag(
        element,
        corner,
        dx,
        dy,
        plateSize,
        margins,
        noSnap,
        true,
      );

      expect(resized.widthMm / resized.heightMm).toBeCloseTo(3);
      expect(oppositeCorner(corner, resized)).toEqual(
        oppositeCorner(corner, element),
      );
    },
  );

  it("uses the vertical drag when it makes the larger proportional change", () => {
    const resized = resizeFrameFromDrag(
      element,
      "se",
      1,
      4,
      plateSize,
      margins,
      noSnap,
      true,
    );

    expect(resized).toMatchObject({ widthMm: 24, heightMm: 8 });
  });

  it("keeps the ratio when the right edge snaps to the label", () => {
    const resized = resizeFrameFromDrag(
      element,
      "se",
      23.6,
      1,
      plateSize,
      margins,
      { xMm: 0.5, yMm: 0.5 },
      true,
    );

    expect(resized.xMm + resized.widthMm).toBe(40);
    expect(resized.widthMm / resized.heightMm).toBeCloseTo(3);
  });

  it("keeps the ratio when the bottom edge snaps to the printable limit", () => {
    const resized = resizeFrameFromDrag(
      element,
      "se",
      0,
      5.6,
      plateSize,
      margins,
      { xMm: 0.5, yMm: 0.5 },
      true,
    );

    expect(resized.yMm + resized.heightMm).toBe(13);
    expect(resized.widthMm / resized.heightMm).toBeCloseTo(3);
  });

  it("keeps independent width and height changes without Shift", () => {
    const resized = resizeFrameFromDrag(
      element,
      "se",
      6,
      1,
      plateSize,
      margins,
      noSnap,
      false,
    );

    expect(resized).toMatchObject({ widthMm: 18, heightMm: 5 });
  });
});
