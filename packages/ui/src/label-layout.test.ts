import { describe, expect, it } from "vitest";

import { nonPrintableMarginsMm } from "./label-layout.js";

describe("printer margin layout", () => {
  it("uses independent margins on the nominal media size", () => {
    expect(nonPrintableMarginsMm(16, 12, 1, 3)).toEqual({
      topMm: 1,
      bottomMm: 3,
    });
  });

  it("removes both margins when a narrow label fits under the print head", () => {
    expect(nonPrintableMarginsMm(10, 12, 2, 2)).toEqual({
      topMm: 0,
      bottomMm: 0,
    });
  });

  it("keeps the configured head offset as the label size changes", () => {
    expect(nonPrintableMarginsMm(14, 12, 1, 3)).toEqual({
      topMm: 0,
      bottomMm: 2,
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
    "shows no %s-aligned guide when the label fits under the head",
    (rasterAlignment) => {
      expect(nonPrintableMarginsMm(10, 12, 1, 3, rasterAlignment)).toEqual({
        topMm: 0,
        bottomMm: 0,
      });
    },
  );
});
