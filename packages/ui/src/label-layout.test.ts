import { describe, expect, it } from "vitest";
import {
  nonPrintableMarginsMm,
  printableVerticalCrop,
} from "./label-layout.js";

describe("paper and printhead layout", () => {
  it.each([
    [16, 2, 12],
    [14, 1, 12],
    [12, 0, 12],
    [9, 0, 9],
  ])(
    "calculates blank areas and thumbnail crop for %s mm paper",
    (paper, blank, height) => {
      const margins = nonPrintableMarginsMm(paper, 12);
      expect(margins).toEqual({ topMm: blank, bottomMm: blank });
      expect(printableVerticalCrop(paper, margins)).toEqual({
        topMm: blank,
        bottomMm: blank,
        heightMm: height,
      });
    },
  );
  it.each([
    ["start", 0, 4],
    ["center", 2, 2],
    ["end", 4, 0],
  ] as const)("uses %s alignment", (alignment, topMm, bottomMm) => {
    expect(nonPrintableMarginsMm(16, 12, alignment)).toEqual({
      topMm,
      bottomMm,
    });
    expect(nonPrintableMarginsMm(9, 12, alignment)).toEqual({
      topMm: 0,
      bottomMm: 0,
    });
  });
  it("shows the full paper when printer capabilities are missing", () => {
    expect(nonPrintableMarginsMm(16, undefined)).toEqual({
      topMm: 0,
      bottomMm: 0,
    });
  });
});
