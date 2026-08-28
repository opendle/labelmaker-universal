import type { PrinterSettings } from "@labelmaker/printing";

const MAX_DISPLAY_NAME_LENGTH = 80;
const ALLOWED_KEYS = new Set([
  "displayName",
  "darkness",
  "printHeadSizeMm",
  "marginTopMm",
  "marginBottomMm",
]);

export function validatePrinterSettings(value: unknown): PrinterSettings {
  if (!isPrinterSettings(value)) {
    throw new TypeError("Printer settings are invalid.");
  }
  return value;
}

export function readStoredPrinterSettings(
  value: unknown,
  printerIds: readonly string[],
): Readonly<Record<string, PrinterSettings>> {
  if (!isRecord(value)) return {};
  const configuredIds = new Set(printerIds);
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, PrinterSettings] =>
        configuredIds.has(entry[0]) && isPrinterSettings(entry[1]),
    ),
  );
}

function isPrinterSettings(value: unknown): value is PrinterSettings {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => ALLOWED_KEYS.has(key)) &&
    (!("displayName" in value) ||
      (typeof value.displayName === "string" &&
        value.displayName === value.displayName.trim() &&
        value.displayName.length > 0 &&
        value.displayName.length <= MAX_DISPLAY_NAME_LENGTH)) &&
    (!("darkness" in value) ||
      (typeof value.darkness === "number" &&
        Number.isInteger(value.darkness) &&
        value.darkness >= 0 &&
        value.darkness <= 31)) &&
    (!("printHeadSizeMm" in value) ||
      isTenthMillimeter(value.printHeadSizeMm, 0.1)) &&
    (!("marginTopMm" in value) || isTenthMillimeter(value.marginTopMm, 0)) &&
    (!("marginBottomMm" in value) || isTenthMillimeter(value.marginBottomMm, 0))
  );
}

function isTenthMillimeter(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= 100 &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-8
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
