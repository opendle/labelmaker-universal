import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  MAX_PRINTER_DISPLAY_NAME_LENGTH,
  type PrinterDescriptor,
  type PrinterSettings,
} from "@labelmaker/printing";

const CONFIGURATION_VERSION = 2;
const LEGACY_CONFIGURATION_VERSION = 1;
const MAX_PRINTERS = 100;
const MAX_PRINTER_ID_LENGTH = 256;
const MAX_ADAPTER_ID_LENGTH = 80;
const MAX_CONNECTION_STRING_LENGTH = 1_024;
const MAX_CONNECTION_DEPTH = 6;
const MAX_CONNECTION_VALUES = 128;
const MAX_PROFILE_ID_LENGTH = 80;
const PERSISTABLE_MAKEID_TRANSPORTS = new Set([
  "bluetooth-classic",
  "bluetooth-low-energy",
]);
const TRANSIENT_MAKEID_PROFILE_IDS = new Set([
  "unresolved-l1",
  "unresolved-p31",
]);
const pendingWrites = new Map<string, Promise<void>>();

/** A descriptor that is safe to restore without nearby-printer discovery. */
export type SavedPrinterRecord = PrinterDescriptor;

interface StoredPrinterConfiguration {
  readonly version: typeof CONFIGURATION_VERSION;
  readonly printerIds: readonly string[];
  readonly activePrinterId?: string;
  readonly printerSettings?: Readonly<Record<string, PrinterSettings>>;
  readonly savedPrinterRecords: Readonly<Record<string, SavedPrinterRecord>>;
}

interface ReadPrinterConfiguration {
  readonly sourceVersion:
    | typeof LEGACY_CONFIGURATION_VERSION
    | typeof CONFIGURATION_VERSION;
  readonly printerIds: readonly string[];
  readonly activePrinterId?: string;
  readonly printerSettings: Readonly<Record<string, PrinterSettings>>;
  readonly savedPrinterRecords: Readonly<Record<string, SavedPrinterRecord>>;
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

export async function readSavedPrinterRecords(
  filePath: string,
): Promise<Readonly<Record<string, SavedPrinterRecord>>> {
  return (
    (await tryReadPrinterConfiguration(filePath))?.savedPrinterRecords ?? {}
  );
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
  if (current !== undefined) {
    if (current.sourceVersion === LEGACY_CONFIGURATION_VERSION) {
      await writeConfiguredPrinterIds(
        filePath,
        current.printerIds,
        current.activePrinterId,
        current.printerSettings,
        current.savedPrinterRecords,
      );
    }
    return current.printerIds;
  }
  const legacy = await tryReadPrinterConfiguration(legacyFilePath);
  if (legacy === undefined) return [];
  await writeConfiguredPrinterIds(
    filePath,
    legacy.printerIds,
    legacy.activePrinterId,
    legacy.printerSettings,
    legacy.savedPrinterRecords,
  );
  return legacy.printerIds;
}

async function tryReadPrinterConfiguration(
  filePath: string,
): Promise<ReadPrinterConfiguration | undefined> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const parsed: unknown = JSON.parse(contents);
  const configuration = readStoredPrinterConfiguration(parsed);
  if (configuration === undefined) {
    throw new TypeError("The saved printer configuration is invalid");
  }
  return configuration;
}

export async function writeConfiguredPrinterIds(
  filePath: string,
  printerIds: Iterable<string>,
  activePrinterId?: string,
  printerSettings: Readonly<Record<string, PrinterSettings>> = {},
  savedPrinterRecords: Readonly<Record<string, SavedPrinterRecord>> = {},
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
    savedPrinterRecords: validatedSavedPrinterRecords(
      storedPrinterIds,
      savedPrinterRecords,
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

function readStoredPrinterConfiguration(
  value: unknown,
): ReadPrinterConfiguration | undefined {
  if (
    !isRecord(value) ||
    (value.version !== LEGACY_CONFIGURATION_VERSION &&
      value.version !== CONFIGURATION_VERSION)
  ) {
    return undefined;
  }
  const printerIds = value.printerIds;
  if (
    !Array.isArray(printerIds) ||
    printerIds.length > MAX_PRINTERS ||
    !printerIds.every(isPersistablePrinterId)
  ) {
    return undefined;
  }
  if (
    value.activePrinterId !== undefined &&
    (!isPersistablePrinterId(value.activePrinterId) ||
      !printerIds.includes(value.activePrinterId))
  ) {
    return undefined;
  }
  if (
    value.printerSettings !== undefined &&
    (!isRecord(value.printerSettings) ||
      !Object.entries(value.printerSettings).every(
        ([printerId, settings]) =>
          printerIds.includes(printerId) && isPrinterSettings(settings),
      ))
  ) {
    return undefined;
  }

  const savedPrinterRecords =
    value.version === CONFIGURATION_VERSION
      ? value.savedPrinterRecords
      : undefined;
  if (
    value.version === CONFIGURATION_VERSION &&
    (!isRecord(savedPrinterRecords) ||
      Object.keys(savedPrinterRecords).length > MAX_PRINTERS ||
      !Object.entries(savedPrinterRecords).every(
        ([printerId, record]) =>
          printerIds.includes(printerId) &&
          isSavedPrinterRecord(record, printerId),
      ))
  ) {
    return undefined;
  }

  return {
    sourceVersion: value.version,
    printerIds,
    ...(value.activePrinterId === undefined
      ? {}
      : { activePrinterId: value.activePrinterId }),
    printerSettings:
      value.printerSettings === undefined
        ? {}
        : (value.printerSettings as Readonly<Record<string, PrinterSettings>>),
    savedPrinterRecords:
      value.version === CONFIGURATION_VERSION
        ? (savedPrinterRecords as Readonly<Record<string, SavedPrinterRecord>>)
        : {},
  };
}

function validatedSavedPrinterRecords(
  printerIds: readonly string[],
  records: Readonly<Record<string, SavedPrinterRecord>>,
): Readonly<Record<string, SavedPrinterRecord>> {
  if (!isRecord(records)) {
    throw new TypeError("Saved printer records must be an object");
  }
  const storedRecords: Record<string, SavedPrinterRecord> = {};
  for (const [printerId, record] of Object.entries(records)) {
    if (!printerIds.includes(printerId)) continue;
    if (!isSavedPrinterRecord(record, printerId)) {
      throw new TypeError(`Saved printer record is invalid: ${printerId}`);
    }
    storedRecords[printerId] = record;
  }
  return storedRecords;
}

function isSavedPrinterRecord(
  value: unknown,
  expectedPrinterId: string,
): value is SavedPrinterRecord {
  if (
    !isRecord(value) ||
    value.id !== expectedPrinterId ||
    !isPersistablePrinterId(value.id) ||
    !isBoundedText(value.adapterId, MAX_ADAPTER_ID_LENGTH) ||
    !isBoundedDisplayText(value.displayName) ||
    (value.model !== undefined && !isBoundedDisplayText(value.model)) ||
    !isJsonSafeConnection(value.connection)
  ) {
    return false;
  }

  // MakeID records are intentionally explicit. The opaque transport key can
  // differ on Android, Windows, Apple platforms, and Linux, but the stable
  // profile ID must not be inferred from that key or from the printer ID.
  return (
    value.adapterId === "makeid" &&
    typeof value.transport === "string" &&
    PERSISTABLE_MAKEID_TRANSPORTS.has(value.transport) &&
    isMakeIdConnection(value.connection, expectedPrinterId)
  );
}

function isMakeIdConnection(
  value: Readonly<Record<string, unknown>>,
  printerId: string,
): boolean {
  const allowedKeys = new Set([
    "transportDeviceId",
    "profileId",
    "advertisedName",
  ]);
  return (
    Object.keys(value).every((key) => allowedKeys.has(key)) &&
    isBoundedText(value.transportDeviceId, MAX_CONNECTION_STRING_LENGTH) &&
    printerId === `makeid:${value.transportDeviceId}` &&
    isPersistableProfileId(value.profileId) &&
    (value.advertisedName === undefined ||
      isBoundedText(value.advertisedName, MAX_CONNECTION_STRING_LENGTH))
  );
}

function isPersistableProfileId(value: unknown): value is string {
  return (
    isBoundedText(value, MAX_PROFILE_ID_LENGTH) &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    !TRANSIENT_MAKEID_PROFILE_IDS.has(value)
  );
}

function isJsonSafeConnection(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  const remaining = { count: MAX_CONNECTION_VALUES };
  return isJsonSafeValue(value, 0, remaining);
}

function isJsonSafeValue(
  value: unknown,
  depth: number,
  remaining: { count: number },
): boolean {
  remaining.count -= 1;
  if (remaining.count < 0 || depth > MAX_CONNECTION_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    return value.length <= MAX_CONNECTION_STRING_LENGTH;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.every((item) => isJsonSafeValue(item, depth + 1, remaining));
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      key !== "__proto__" &&
      key !== "prototype" &&
      key !== "constructor" &&
      key.length <= MAX_CONNECTION_STRING_LENGTH &&
      isJsonSafeValue(item, depth + 1, remaining),
  );
}

function isBoundedDisplayText(value: unknown): value is string {
  return (
    isBoundedText(value, MAX_PRINTER_DISPLAY_NAME_LENGTH) &&
    value === value.trim()
  );
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function isPrinterSettings(value: unknown): value is PrinterSettings {
  const allowedKeys = new Set([
    "displayName",
    "darkness",
    "printHeadSizeMm",
    "marginTopMm",
    "marginBottomMm",
    "interLabelSpacingMm",
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
    (!("marginBottomMm" in value) ||
      isTenthMillimeter(value.marginBottomMm, 0)) &&
    (!("interLabelSpacingMm" in value) ||
      isTenthMillimeter(value.interLabelSpacingMm, 0))
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
