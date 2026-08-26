import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  MAX_PRINTER_DISPLAY_NAME_LENGTH,
  type PrinterSettings,
} from "@labelmaker/printing";

const CONFIGURATION_VERSION = 1;
const MAX_PRINTERS = 100;
const MAX_PRINTER_ID_LENGTH = 256;
const pendingWrites = new Map<string, Promise<void>>();

interface StoredPrinterConfiguration {
  readonly version: typeof CONFIGURATION_VERSION;
  readonly printerIds: readonly string[];
  readonly activePrinterId?: string;
  readonly printerSettings?: Readonly<Record<string, PrinterSettings>>;
}

/** Mock printers are test fixtures and must be explicitly enabled. */
export function mockPrintersEnabled(value: string | undefined): boolean {
  return value === "1";
}

export function initialConfiguredPrinterIds(
  storedPrinterIds: readonly string[],
  includeMockPrinters: boolean,
): Set<string> {
  const printerIds = new Set(storedPrinterIds.filter(isPersistablePrinterId));
  if (includeMockPrinters) printerIds.add("mock-studio");
  return printerIds;
}

export async function readConfiguredPrinterIds(
  filePath: string,
): Promise<readonly string[]> {
  return (await tryReadPrinterConfiguration(filePath))?.printerIds ?? [];
}

export async function readActivePrinterId(
  filePath: string,
): Promise<string | undefined> {
  return (await tryReadPrinterConfiguration(filePath))?.activePrinterId;
}

export async function readPrinterSettings(
  filePath: string,
): Promise<Readonly<Record<string, PrinterSettings>>> {
  return (await tryReadPrinterConfiguration(filePath))?.printerSettings ?? {};
}

export function normalizePrinterDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Printer display name must be text");
  }
  const displayName = value.trim();
  if (
    displayName.length === 0 ||
    displayName.length > MAX_PRINTER_DISPLAY_NAME_LENGTH
  ) {
    throw new RangeError(
      `Printer display name must use 1 to ${MAX_PRINTER_DISPLAY_NAME_LENGTH} characters`,
    );
  }
  return displayName;
}

/** Move configuration from the old package-name directory on first launch. */
export async function readConfiguredPrinterIdsWithLegacy(
  filePath: string,
  legacyFilePath: string,
): Promise<readonly string[]> {
  const current = await tryReadPrinterConfiguration(filePath);
  if (current !== undefined) return current.printerIds;
  const legacy = await tryReadPrinterConfiguration(legacyFilePath);
  if (legacy === undefined) return [];
  await writeConfiguredPrinterIds(
    filePath,
    legacy.printerIds,
    legacy.activePrinterId,
  );
  return legacy.printerIds;
}

async function tryReadPrinterConfiguration(
  filePath: string,
): Promise<StoredPrinterConfiguration | undefined> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  if (!isStoredPrinterConfiguration(parsed)) {
    throw new TypeError("The saved printer configuration is invalid");
  }
  return parsed;
}

export async function writeConfiguredPrinterIds(
  filePath: string,
  printerIds: Iterable<string>,
  activePrinterId?: string,
  printerSettings: Readonly<Record<string, PrinterSettings>> = {},
): Promise<void> {
  const storedPrinterIds = [
    ...new Set([...printerIds].filter(isPersistablePrinterId)),
  ]
    .sort()
    .slice(0, MAX_PRINTERS);
  const stored: StoredPrinterConfiguration = {
    version: CONFIGURATION_VERSION,
    printerIds: storedPrinterIds,
    ...(activePrinterId !== undefined &&
    storedPrinterIds.includes(activePrinterId)
      ? { activePrinterId }
      : {}),
    printerSettings: Object.fromEntries(
      Object.entries(printerSettings).filter(
        ([printerId, settings]) =>
          storedPrinterIds.includes(printerId) && isPrinterSettings(settings),
      ),
    ),
  };
  const resolvedFilePath = resolve(filePath);
  const previousWrite = pendingWrites.get(resolvedFilePath);
  const write = (previousWrite ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writePrinterConfiguration(resolvedFilePath, stored));
  pendingWrites.set(resolvedFilePath, write);

  try {
    await write;
  } finally {
    if (pendingWrites.get(resolvedFilePath) === write) {
      pendingWrites.delete(resolvedFilePath);
    }
  }
}

async function writePrinterConfiguration(
  filePath: string,
  stored: StoredPrinterConfiguration,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }
}

function isStoredPrinterConfiguration(
  value: unknown,
): value is StoredPrinterConfiguration {
  if (!isRecord(value) || value.version !== CONFIGURATION_VERSION) return false;
  const printerIds = value.printerIds;
  if (
    !Array.isArray(printerIds) ||
    printerIds.length > MAX_PRINTERS ||
    !printerIds.every(isPersistablePrinterId)
  ) {
    return false;
  }
  if (
    value.activePrinterId !== undefined &&
    (!isPersistablePrinterId(value.activePrinterId) ||
      !printerIds.includes(value.activePrinterId))
  ) {
    return false;
  }
  return (
    value.printerSettings === undefined ||
    (isRecord(value.printerSettings) &&
      Object.entries(value.printerSettings).every(
        ([printerId, settings]) =>
          printerIds.includes(printerId) && isPrinterSettings(settings),
      ))
  );
}

function isPrinterSettings(value: unknown): value is PrinterSettings {
  const allowedKeys = new Set([
    "displayName",
    "darkness",
    "printHeadSizeMm",
    "marginTopMm",
    "marginBottomMm",
  ]);
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    (!("displayName" in value) ||
      (typeof value.displayName === "string" &&
        value.displayName === value.displayName.trim() &&
        value.displayName.length > 0 &&
        value.displayName.length <= MAX_PRINTER_DISPLAY_NAME_LENGTH)) &&
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

function isPersistablePrinterId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("makeid:") &&
    value.length > "makeid:".length &&
    value.length <= MAX_PRINTER_ID_LENGTH
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
