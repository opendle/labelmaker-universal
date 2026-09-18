import { describe, expect, it } from "vitest";
import {
  printerVerticalGeometry,
  readLegacyPrinterSettings,
  isPrinterSettings,
  type RasterAlignment,
} from "./index.js";

describe("paper and printhead overlap", () => {
  it.each([
    [16, 2, 2, 12],
    [14, 1, 1, 12],
    [12, 0, 0, 12],
    [9, -1.5, 0, 9],
  ])(
    "centers %s mm paper on a 12 mm head",
    (paper, headTopMm, blank, heightMm) => {
      expect(printerVerticalGeometry(paper, 12, "center")).toEqual({
        headTopMm,
        topMm: blank,
        bottomMm: blank,
        heightMm,
      });
    },
  );
  it.each([
    ["start", 0, 0, 4],
    ["end", 4, 4, 0],
  ] as const)(
    "places a smaller head at the %s",
    (alignment, headTopMm, topMm, bottomMm) => {
      expect(printerVerticalGeometry(16, 12, alignment)).toEqual({
        headTopMm,
        topMm,
        bottomMm,
        heightMm: 12,
      });
    },
  );
  it.each([
    ["start", 0],
    ["center", -1.5],
    ["end", -3],
  ] as const)("places smaller paper at the %s", (alignment, headTopMm) => {
    expect(printerVerticalGeometry(9, 12, alignment)).toEqual({
      headTopMm,
      topMm: 0,
      bottomMm: 0,
      heightMm: 9,
    });
  });
  it.each(["start", "center", "end"] as const)(
    "keeps fractional dimensions with %s alignment",
    (alignment) => {
      const wide = printerVerticalGeometry(14.3, 12.2, alignment);
      expect(wide.heightMm).toBeCloseTo(12.2);
      expect(wide.topMm + wide.bottomMm).toBeCloseTo(2.1);
      const narrow = printerVerticalGeometry(9.3, 12.2, alignment);
      expect(narrow.heightMm).toBeCloseTo(9.3);
      expect(narrow.topMm + narrow.bottomMm).toBeCloseTo(0);
    },
  );
  it.each([0, -1, NaN, Infinity, -Infinity])(
    "rejects invalid dimensions %s",
    (value) => {
      expect(() => printerVerticalGeometry(value, 12)).toThrow(RangeError);
      expect(() => printerVerticalGeometry(12, value)).toThrow(RangeError);
    },
  );
  it("rejects invalid alignment", () => {
    expect(() =>
      printerVerticalGeometry(12, 12, "invalid" as RasterAlignment),
    ).toThrow(RangeError);
  });
});

describe("legacy printer settings", () => {
  const settings = {
    displayName: "Workshop",
    darkness: 24,
    printHeadSizeMm: 12.2,
    interLabelSpacingMm: 1.5,
    feedAfterPrintMm: 3,
    minimumLabelWidthMm: 22,
  };
  it("removes only validated old margins and preserves the input", () => {
    const old = { ...settings, marginTopMm: 1.9, marginBottomMm: 0 };
    expect(readLegacyPrinterSettings(old)).toEqual(settings);
    expect(old.marginTopMm).toBe(1.9);
    expect(readLegacyPrinterSettings(settings)).toEqual(settings);
    expect(isPrinterSettings(old)).toBe(false);
  });
  it.each([
    null,
    [],
    { marginTopMm: -1 },
    { marginBottomMm: 0.15 },
    { marginTopMm: undefined },
    { marginTopMm: NaN },
    { marginBottomMm: Infinity },
    { darkness: 32 },
    { unknown: 1 },
  ])("rejects invalid old records %s", (old) => {
    expect(readLegacyPrinterSettings(old)).toBeUndefined();
  });
});
