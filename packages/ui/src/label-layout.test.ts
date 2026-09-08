import { describe, expect, it } from "vitest";

import {
  nonPrintableMarginsMm,
  printableVerticalCrop,
} from "./label-layout.js";

describe("printer margin layout", () => {
  it.each([
    [5, 3.3, 1.7],
    [16, 8.2, 7.8],
    [0.8, 0.1, 0.7],
  ])(
    "has no printable height when decimal margins cover %s mm",
    (height, top, bottom) => {
      const margins = nonPrintableMarginsMm(height, 12, top, bottom);
      expect(printableVerticalCrop(height, margins).heightMm).toBe(0);
    },
  );

  it.each([
    [10, 0, 0, 0, 0],
    [10, 4, 4, 4, 4],
    [10, 0, 4, 0, 4],
    [10, 4, 0, 4, 0],
    [10, 8, 8, 8, 2],
    [10, 100, 0, 10, 0],
    [16, 0, 0, 2, 2],
    [16, 1, 1, 2, 2],
  ])(
    "limits %s mm media with margins %s / %s",
    (height, top, bottom, expectedTop, expectedBottom) => {
      expect(nonPrintableMarginsMm(height, 12, top, bottom)).toEqual({
        topMm: expectedTop,
        bottomMm: expectedBottom,
      });
    },
  );

  it("uses independent margins on the nominal media size", () => {
    expect(nonPrintableMarginsMm(16, 12, 1, 3)).toEqual({
      topMm: 2,
      bottomMm: 3,
    });
  });

  it("shows two 2 mm guides for centered MakeID E1 media", () => {
    expect(nonPrintableMarginsMm(16, 12, 2, 2, "center")).toEqual({
      topMm: 2,
      bottomMm: 2,
    });
  });

  it("keeps both margins when a narrow label fits under the print head", () => {
    expect(nonPrintableMarginsMm(10, 12, 2, 2)).toEqual({
      topMm: 2,
      bottomMm: 2,
    });
  });

  it("keeps each requested blank margin as the label size changes", () => {
    expect(nonPrintableMarginsMm(14, 12, 1, 3)).toEqual({
      topMm: 1,
      bottomMm: 3,
    });
  });

  it.each([
    ["start", { topMm: 0, bottomMm: 4 }],
    ["center", { topMm: 2, bottomMm: 2 }],
    ["end", { topMm: 4, bottomMm: 0 }],
  ] as const)(
    "shows the %s-aligned printable area on wide media",
    (rasterAlignment, expected) => {
      expect(nonPrintableMarginsMm(16, 12, 0, 0, rasterAlignment)).toEqual(
        expected,
      );
    },
  );

  it.each(["start", "center", "end"] as const)(
    "shows both %s-aligned guides when the label fits under the head",
    (rasterAlignment) => {
      expect(nonPrintableMarginsMm(10, 12, 1, 3, rasterAlignment)).toEqual({
        topMm: 1,
        bottomMm: 3,
      });
    },
  );
});
