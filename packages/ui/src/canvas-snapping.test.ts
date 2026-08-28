import type { ImageElement, TextElement } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";

import { snapMovedElement, snapResizedFrame } from "./canvas-snapping.js";

const text: TextElement = {
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
const image: ImageElement = {
  id: "image",
  kind: "image",
  xMm: 4,
  yMm: 3,
  widthMm: 12,
  heightMm: 4,
  rotationDeg: 0,
  source: "data:image/png;base64,AA==",
  fit: "contain",
  threshold: 128,
};
const size = { widthMm: 40, heightMm: 16 };
const margins = { topMm: 2, bottomMm: 3 };
const thresholds = { xMm: 0.5, yMm: 0.5 };

describe("canvas snapping", () => {
  it.each([text, image])(
    "snaps a moved $kind frame to printable edges",
    (element) => {
      expect(
        snapMovedElement(
          { ...element, xMm: 0.4, yMm: 2.4 },
          size,
          margins,
          thresholds,
        ),
      ).toMatchObject({ xMm: 0, yMm: 2 });

      expect(
        snapMovedElement(
          { ...element, xMm: 28.4, yMm: 8.6 },
          size,
          margins,
          thresholds,
        ),
      ).toMatchObject({ xMm: 28, yMm: 9 });
    },
  );

  it("snaps a moved frame to both printable centers", () => {
    expect(
      snapMovedElement(
        { ...text, xMm: 14.4, yMm: 5.2 },
        size,
        margins,
        thresholds,
      ),
    ).toMatchObject({ xMm: 14, yMm: 5.5 });
  });

  it("snaps moved frames to the absolute top and bottom limits", () => {
    expect(
      snapMovedElement({ ...image, yMm: 0.4 }, size, margins, thresholds),
    ).toMatchObject({ yMm: 0 });
    expect(
      snapMovedElement({ ...image, yMm: 11.6 }, size, margins, thresholds),
    ).toMatchObject({ yMm: 12 });
  });

  it("does not snap a frame outside the attraction threshold", () => {
    expect(
      snapMovedElement({ ...text, xMm: 1, yMm: 3 }, size, margins, thresholds),
    ).toMatchObject({ xMm: 1, yMm: 3 });
  });

  it("snaps resized sides to the printable limits", () => {
    expect(
      snapResizedFrame(
        { ...text, xMm: 0.4, yMm: 2.4, widthMm: 20, heightMm: 6 },
        size,
        margins,
        thresholds,
        { left: true, top: true },
      ),
    ).toMatchObject({ xMm: 0, yMm: 2, widthMm: 20.4, heightMm: 6.4 });

    expect(
      snapResizedFrame(
        { ...text, xMm: 4, yMm: 3, widthMm: 35.6, heightMm: 9.6 },
        size,
        margins,
        thresholds,
        { left: false, top: false },
      ),
    ).toMatchObject({ widthMm: 36, heightMm: 10 });
  });

  it("snaps resized sides to the absolute top and bottom limits", () => {
    expect(
      snapResizedFrame(
        { ...image, yMm: 0.4, heightMm: 8 },
        size,
        margins,
        thresholds,
        { left: false, top: true },
      ),
    ).toMatchObject({ yMm: 0, heightMm: 8.4 });
    expect(
      snapResizedFrame(
        { ...image, yMm: 3, heightMm: 12.6 },
        size,
        margins,
        thresholds,
        { left: false, top: false },
      ),
    ).toMatchObject({ heightMm: 13 });
  });
});
