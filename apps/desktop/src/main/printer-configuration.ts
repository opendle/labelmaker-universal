import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CONFIGURATION_VERSION = 1;
const MAX_PRINTERS = 100;
const MAX_PRINTER_ID_LENGTH = 256;

interface StoredPrinterConfiguration {
  readonly version: typeof CONFIGURATION_VERSION;
  readonly printerIds: readonly string[];
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
  return (await tryReadConfiguredPrinterIds(filePath)) ?? [];
}

/** Move configuration from the old package-name directory on first launch. */
export async function readConfiguredPrinterIdsWithLegacy(
  filePath: string,
  legacyFilePath: string,
): Promise<readonly string[]> {
  const current = await tryReadConfiguredPrinterIds(filePath);
  if (current !== undefined) return current;
  const legacy = await tryReadConfiguredPrinterIds(legacyFilePath);
  if (legacy === undefined) return [];
  await writeConfiguredPrinterIds(filePath, legacy);
  return legacy;
}

async function tryReadConfiguredPrinterIds(
  filePath: string,
): Promise<readonly string[] | undefined> {
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
  return parsed.printerIds;
}

export async function writeConfiguredPrinterIds(
  filePath: string,
  printerIds: Iterable<string>,
): Promise<void> {
  const stored: StoredPrinterConfiguration = {
    version: CONFIGURATION_VERSION,
    printerIds: [...new Set([...printerIds].filter(isPersistablePrinterId))]
      .sort()
      .slice(0, MAX_PRINTERS),
  };
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}

function isStoredPrinterConfiguration(
  value: unknown,
): value is StoredPrinterConfiguration {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === CONFIGURATION_VERSION &&
    "printerIds" in value &&
    Array.isArray(value.printerIds) &&
    value.printerIds.length <= MAX_PRINTERS &&
    value.printerIds.every(isPersistablePrinterId)
  );
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
