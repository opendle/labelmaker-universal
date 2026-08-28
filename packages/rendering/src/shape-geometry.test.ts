import { describe, expect, it } from "vitest";

import {
  shapeLineStrokeWidthMm,
  shapeRenderGeometry,
} from "./shape-geometry.js";

const frame = {
  widthMm: 8,
  heightMm: 6,
  strokeWidthMm: 0.5,
  filled: false,
  cornerRadiusMm: 1,
};

describe("shape render geometry", () => {
  it("insets an outline so its outer edge matches the frame", () => {
    expect(shapeRenderGeometry(frame)).toEqual({
      cornerRadiusMm: 0.75,
      filled: false,
      heightMm: 5.5,
      insetMm: 0.25,
      strokeWidthMm: 0.5,
      widthMm: 7.5,
    });
  });

  it("uses the complete frame for a filled shape", () => {
    expect(shapeRenderGeometry({ ...frame, filled: true })).toEqual({
      cornerRadiusMm: 1,
      filled: true,
      heightMm: 6,
      insetMm: 0,
      strokeWidthMm: 0,
      widthMm: 8,
    });
  });

  it("keeps an oversized stroke inside the frame", () => {
    expect(shapeRenderGeometry({ ...frame, strokeWidthMm: 7 })).toMatchObject({
      filled: true,
      heightMm: 6,
      insetMm: 0,
      strokeWidthMm: 0,
      widthMm: 8,
    });
    expect(shapeLineStrokeWidthMm({ ...frame, strokeWidthMm: 7 })).toBe(6);
  });
});
