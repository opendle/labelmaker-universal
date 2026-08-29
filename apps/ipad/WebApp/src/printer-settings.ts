import { isPrinterSettings, type PrinterSettings } from "@labelmaker/printing";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
