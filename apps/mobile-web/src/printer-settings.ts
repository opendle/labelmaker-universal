import {
  isPrinterSettings,
  readLegacyPrinterSettings,
  type PrinterSettings,
} from "@labelmaker/printing";

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
    Object.entries(value).flatMap(([id, value]) => {
      const settings = readLegacyPrinterSettings(value);
      return configuredIds.has(id) && settings !== undefined
        ? [[id, settings]]
        : [];
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
