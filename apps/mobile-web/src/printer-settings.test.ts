import { describe, expect, it } from "vitest";

import {
  readStoredPrinterSettings,
  validatePrinterSettings,
} from "./printer-settings.js";

describe("iPad printer settings", () => {
  it("accepts complete valid settings", () => {
    const settings = {
      displayName: "Workshop printer",
      darkness: 20,
      printHeadSizeMm: 12.5,
      interLabelSpacingMm: 1.5,
      feedAfterPrintMm: 11,
      minimumLabelWidthMm: 16,
    };

    expect(validatePrinterSettings(settings)).toEqual(settings);
  });

  it.each([
    { displayName: " Printer" },
    { darkness: 32 },
    { printHeadSizeMm: 0 },
    { marginTopMm: 0 },
    { marginTopMm: -0.1 },
    { marginBottomMm: 2 },
    { marginBottomMm: 0.15 },
    { interLabelSpacingMm: 0.15 },
    { minimumLabelWidthMm: 100.1 },
    { minimumLabelWidthMm: 0.15 },
    { feedAfterPrintMm: 100.1 },
    { feedAfterPrintMm: 0.15 },
    { extra: true },
  ])("rejects invalid settings: $settings", (settings) => {
    expect(() => validatePrinterSettings(settings)).toThrow(
      "Printer settings are invalid.",
    );
  });

  it("keeps valid settings only for configured printers", () => {
    expect(
      readStoredPrinterSettings(
        {
          configured: { darkness: 18, marginTopMm: 0.5 },
          invalid: { marginTopMm: Number.NaN },
          removed: { displayName: "Old printer" },
        },
        ["configured", "invalid"],
      ),
    ).toEqual({ configured: { darkness: 18 } });
  });
});
