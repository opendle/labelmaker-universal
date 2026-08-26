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
});
