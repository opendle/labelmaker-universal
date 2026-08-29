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

const rotatedCorner = (
  corner: ResizeCorner,
  frame: TextElement,
  opposite = false,
) => {
  const horizontalDirection =
    (corner.includes("w") ? -1 : 1) * (opposite ? -1 : 1);
  const verticalDirection =
    (corner.includes("n") ? -1 : 1) * (opposite ? -1 : 1);
  const radians = (frame.rotationDeg * Math.PI) / 180;
  const x = (horizontalDirection * frame.widthMm) / 2;
  const y = (verticalDirection * frame.heightMm) / 2;
  return {
    x:
      frame.xMm +
      frame.widthMm / 2 +
      x * Math.cos(radians) -
      y * Math.sin(radians),
    y:
      frame.yMm +
      frame.heightMm / 2 +
      x * Math.sin(radians) +
      y * Math.cos(radians),
  };
};

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

  it.each(["nw", "ne", "sw", "se"] as const)(
    "resizes a 90-degree frame in its visible axes from the %s handle",
    (corner) => {
      const rotated = { ...element, rotationDeg: 90 };
      const beforeDraggedCorner = rotatedCorner(corner, rotated);
      const beforeOppositeCorner = rotatedCorner(corner, rotated, true);
      const resized = resizeFrameFromDrag(
        rotated,
        corner,
        0,
        corner.includes("w") ? -6 : 6,
        plateSize,
        margins,
        noSnap,
        false,
      );
      const afterDraggedCorner = rotatedCorner(corner, resized);
      const afterOppositeCorner = rotatedCorner(corner, resized, true);

      expect(resized.widthMm).toBe(18);
      expect(resized.heightMm).toBe(4);
      expect(afterDraggedCorner.x).toBeCloseTo(beforeDraggedCorner.x);
      expect(afterDraggedCorner.y).toBeCloseTo(
        beforeDraggedCorner.y + (corner.includes("w") ? -6 : 6),
      );
      expect(afterOppositeCorner.x).toBeCloseTo(beforeOppositeCorner.x);
      expect(afterOppositeCorner.y).toBeCloseTo(beforeOppositeCorner.y);
    },
  );

  it("preserves proportions in the visible axes of a rotated frame", () => {
    const rotated = { ...element, rotationDeg: 90 };
    const beforeOppositeCorner = rotatedCorner("se", rotated, true);
    const resized = resizeFrameFromDrag(
      rotated,
      "se",
      -1,
      6,
      plateSize,
      margins,
      noSnap,
      true,
    );

    expect(resized.widthMm / resized.heightMm).toBeCloseTo(3);
    expect(rotatedCorner("se", resized, true).x).toBeCloseTo(
      beforeOppositeCorner.x,
    );
    expect(rotatedCorner("se", resized, true).y).toBeCloseTo(
      beforeOppositeCorner.y,
    );
  });

  it("snaps the visible edge of a 90-degree frame to the printable limit", () => {
    const rotated = { ...element, rotationDeg: 90 };
    const beforeOppositeCorner = rotatedCorner("se", rotated, true);
    const resized = resizeFrameFromDrag(
      rotated,
      "se",
      0,
      1.6,
      plateSize,
      margins,
      { xMm: 0.5, yMm: 0.5 },
      false,
    );

    expect(rotatedCorner("se", resized).y).toBe(13);
    expect(rotatedCorner("se", resized, true).x).toBeCloseTo(
      beforeOppositeCorner.x,
    );
    expect(rotatedCorner("se", resized, true).y).toBeCloseTo(
      beforeOppositeCorner.y,
    );
  });
});
