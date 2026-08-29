import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  initialConfiguredPrinterIds,
  mockPrintersEnabled,
  normalizePrinterDisplayName,
  readActivePrinterId,
  readConfiguredPrinterIds,
  readConfiguredPrinterIdsWithLegacy,
  readPrinterSettings,
  readSavedPrinterRecords,
  type SavedPrinterRecord,
  writeConfiguredPrinterIds,
} from "../src/main/printer-configuration.js";

function savedMakeIdPrinter(
  id: string,
  profileId = "l1-ff00-300",
): SavedPrinterRecord {
  return {
    id,
    adapterId: "makeid",
    displayName: "MAKEID-L1",
    model: "MakeID L1 300 dpi",
    transport: "bluetooth-low-energy",
    connection: {
      transportDeviceId: id.slice("makeid:".length),
      profileId,
      advertisedName: "MAKEID-L1",
    },
  };
}

describe("desktop printer configuration", () => {
  it("does not configure a mock printer during a normal launch", () => {
    expect(mockPrintersEnabled(undefined)).toBe(false);
    expect(initialConfiguredPrinterIds([], false)).toEqual(new Set());
  });

  it("enables the mock printer only for an explicit fixture launch", () => {
    expect(mockPrintersEnabled("1")).toBe(true);
    expect(initialConfiguredPrinterIds([], true)).toEqual(
      new Set(["mock-studio"]),
    );
  });

  it("restores an added MakeID printer after a new store instance starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:macos-bt-opaque-test-id";

    await writeConfiguredPrinterIds(filePath, [printerId]);

    expect(await readConfiguredPrinterIds(filePath)).toEqual([printerId]);
    expect(
      initialConfiguredPrinterIds(
        await readConfiguredPrinterIds(filePath),
        false,
      ),
    ).toEqual(new Set([printerId]));
    expect(await readFile(filePath, "utf8")).not.toContain("mock-studio");
    if (process.platform !== "win32") {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("migrates printers from the old application-name directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "current", "configured-printers.json");
    const legacyFilePath = join(
      directory,
      "legacy",
      "configured-printers.json",
    );
    const printerId = "makeid:macos-bt-legacy";
    await mkdir(join(directory, "legacy"), { recursive: true });
    await writeFile(
      legacyFilePath,
      JSON.stringify({
        version: 1,
        printerIds: [printerId],
        activePrinterId: printerId,
        printerSettings: {
          [printerId]: { displayName: "Packing desk", darkness: 19 },
        },
      }),
      "utf8",
    );

    expect(
      await readConfiguredPrinterIdsWithLegacy(filePath, legacyFilePath),
    ).toEqual([printerId]);
    expect(await readConfiguredPrinterIds(filePath)).toEqual([printerId]);
    expect(await readActivePrinterId(filePath)).toBe(printerId);
    expect(await readPrinterSettings(filePath)).toEqual({
      [printerId]: { displayName: "Packing desk", darkness: 19 },
    });
    expect(await readSavedPrinterRecords(filePath)).toEqual({});
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      version: 2,
      printerIds: [printerId],
      activePrinterId: printerId,
      printerSettings: {
        [printerId]: { displayName: "Packing desk", darkness: 19 },
      },
      savedPrinterRecords: {},
    });
  });

  it("migrates a current version-1 file without losing its settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "current", "configured-printers.json");
    const legacyFilePath = join(
      directory,
      "legacy",
      "configured-printers.json",
    );
    const printerId = "makeid:macos-bt-existing-e1";
    await mkdir(join(directory, "current"), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        printerIds: [printerId],
        activePrinterId: printerId,
        printerSettings: {
          [printerId]: { darkness: 22, printHeadSizeMm: 11.8 },
        },
      }),
      "utf8",
    );

    expect(
      await readConfiguredPrinterIdsWithLegacy(filePath, legacyFilePath),
    ).toEqual([printerId]);
    expect(await readActivePrinterId(filePath)).toBe(printerId);
    expect(await readPrinterSettings(filePath)).toEqual({
      [printerId]: { darkness: 22, printHeadSizeMm: 11.8 },
    });
    expect(await readSavedPrinterRecords(filePath)).toEqual({});
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      version: 2,
      printerIds: [printerId],
      activePrinterId: printerId,
      printerSettings: {
        [printerId]: { darkness: 22, printHeadSizeMm: 11.8 },
      },
      savedPrinterRecords: {},
    });
  });

  it("does not restore removed printers when the current file is empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "current", "configured-printers.json");
    const legacyFilePath = join(
      directory,
      "legacy",
      "configured-printers.json",
    );
    await writeConfiguredPrinterIds(filePath, []);
    await writeConfiguredPrinterIds(legacyFilePath, ["makeid:old-printer"]);

    expect(
      await readConfiguredPrinterIdsWithLegacy(filePath, legacyFilePath),
    ).toEqual([]);
  });

  it("persists removing one printer without removing the other configured printers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const first = "makeid:macos-bt-first";
    const second = "makeid:macos-bt-second";

    await writeConfiguredPrinterIds(filePath, [first, second]);
    await writeConfiguredPrinterIds(filePath, [second]);

    expect(await readConfiguredPrinterIds(filePath)).toEqual([second]);
    expect(
      initialConfiguredPrinterIds(
        await readConfiguredPrinterIds(filePath),
        false,
      ),
    ).toEqual(new Set([second]));
  });

  it("remembers the last selected configured printer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const first = "makeid:macos-bt-first";
    const second = "makeid:macos-bt-second";

    await writeConfiguredPrinterIds(filePath, [first, second], second);

    expect(await readActivePrinterId(filePath)).toBe(second);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      activePrinterId: second,
    });
  });

  it("stores settings for each configured printer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const first = "makeid:macos-bt-first";
    const second = "makeid:macos-bt-second";

    await writeConfiguredPrinterIds(filePath, [first, second], first, {
      [first]: {
        displayName: "Studio printer",
        darkness: 24,
        printHeadSizeMm: 11.8,
        marginTopMm: 1.4,
        marginBottomMm: 2.6,
        interLabelSpacingMm: 1.5,
      },
      [second]: { darkness: 18 },
      "makeid:not-configured": { darkness: 31 },
    });

    expect(await readPrinterSettings(filePath)).toEqual({
      [first]: {
        displayName: "Studio printer",
        darkness: 24,
        printHeadSizeMm: 11.8,
        marginTopMm: 1.4,
        marginBottomMm: 2.6,
        interLabelSpacingMm: 1.5,
      },
      [second]: { darkness: 18 },
    });
  });

  it("stores a validated descriptor without changing printer identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:macos-ble-opaque-device-key";
    const descriptor = savedMakeIdPrinter(printerId);

    await writeConfiguredPrinterIds(
      filePath,
      [printerId],
      printerId,
      { [printerId]: { darkness: 21 } },
      { [printerId]: descriptor },
    );

    expect(await readConfiguredPrinterIds(filePath)).toEqual([printerId]);
    expect(await readSavedPrinterRecords(filePath)).toEqual({
      [printerId]: descriptor,
    });
    const stored = JSON.parse(await readFile(filePath, "utf8"));
    expect(stored.printerIds).toEqual([printerId]);
    expect(stored.savedPrinterRecords[printerId].connection.profileId).toBe(
      "l1-ff00-300",
    );
    expect(printerId).not.toContain("300");
    expect(printerId.toLowerCase()).not.toContain("l1");
  });

  it("preserves an unknown stable profile ID without guessing an L1 profile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:macos-ble-future-device";
    const descriptor = savedMakeIdPrinter(printerId, "future-protocol-406");

    await writeConfiguredPrinterIds(
      filePath,
      [printerId],
      undefined,
      {},
      {
        [printerId]: descriptor,
      },
    );

    expect(
      (await readSavedPrinterRecords(filePath))[printerId]?.connection
        .profileId,
    ).toBe("future-protocol-406");
  });

  it("does not require a saved descriptor for a migrated E1-only ID", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:macos-bt-old-e1";
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, printerIds: [printerId] }),
      "utf8",
    );

    expect(await readConfiguredPrinterIds(filePath)).toEqual([printerId]);
    expect(await readSavedPrinterRecords(filePath)).toEqual({});
  });

  it("normalizes a custom printer display name", () => {
    expect(normalizePrinterDisplayName("  Shipping desk  ")).toBe(
      "Shipping desk",
    );
    expect(() => normalizePrinterDisplayName("   ")).toThrow(
      "Printer display name must use 1 to 80 characters",
    );
    expect(() => normalizePrinterDisplayName("x".repeat(81))).toThrow(
      "Printer display name must use 1 to 80 characters",
    );
    expect(() => normalizePrinterDisplayName(42)).toThrow(
      "Printer display name must be text",
    );
  });

  it("completes concurrent writes and stores the last requested state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const writeCount = 100;

    const writes = Array.from({ length: writeCount }, (_, index) => {
      const printerId = `makeid:concurrent-${index}`;
      return writeConfiguredPrinterIds(filePath, [printerId], printerId, {
        [printerId]: { darkness: index % 32 },
      });
    });

    await expect(Promise.all(writes)).resolves.toHaveLength(writeCount);
    const lastPrinterId = `makeid:concurrent-${writeCount - 1}`;
    expect(await readConfiguredPrinterIds(filePath)).toEqual([lastPrinterId]);
    expect(await readActivePrinterId(filePath)).toBe(lastPrinterId);
    expect(await readPrinterSettings(filePath)).toEqual({
      [lastPrinterId]: { darkness: (writeCount - 1) % 32 },
    });
    expect(await readdir(directory)).toEqual(["configured-printers.json"]);
  });

  it("does not use or replace the old fixed temporary path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const oldTemporaryPath = `${filePath}.tmp`;
    await writeFile(oldTemporaryPath, "keep this file", "utf8");

    await writeConfiguredPrinterIds(filePath, ["makeid:valid"]);

    expect(await readFile(oldTemporaryPath, "utf8")).toBe("keep this file");
    expect(await readConfiguredPrinterIds(filePath)).toEqual(["makeid:valid"]);
  });

  it("removes its temporary file when the atomic rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    await mkdir(filePath);

    await expect(
      writeConfiguredPrinterIds(filePath, ["makeid:valid"]),
    ).rejects.toThrow();
    expect(await readdir(directory)).toEqual(["configured-printers.json"]);
  });

  it("rejects corrupt stored printer data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    await writeConfiguredPrinterIds(filePath, ["makeid:valid"]);
    const invalid = `${filePath}.invalid`;
    await writeFile(invalid, '{"version":1,"printerIds":["mock-studio"]}');

    await expect(readConfiguredPrinterIds(invalid)).rejects.toThrow(
      "saved printer configuration is invalid",
    );
  });

  it.each([
    [
      "a record for a printer that is not configured",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          "makeid:different": savedMakeIdPrinter("makeid:different"),
        },
      }),
    ],
    [
      "a record key that does not match its descriptor ID",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: savedMakeIdPrinter("makeid:different"),
        },
      }),
    ],
    [
      "an unsupported adapter",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: {
            ...savedMakeIdPrinter(printerId),
            adapterId: "other",
          },
        },
      }),
    ],
    [
      "an unsupported transport",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: {
            ...savedMakeIdPrinter(printerId),
            transport: "network",
          },
        },
      }),
    ],
    [
      "a missing transport device ID",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: {
            ...savedMakeIdPrinter(printerId),
            connection: { profileId: "l1-ff00-300" },
          },
        },
      }),
    ],
    [
      "a transport device ID that does not match its printer ID",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: {
            ...savedMakeIdPrinter(printerId),
            connection: {
              ...savedMakeIdPrinter(printerId).connection,
              transportDeviceId: "ipad-ble-different-printer",
            },
          },
        },
      }),
    ],
    [
      "a transient unresolved profile",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: savedMakeIdPrinter(printerId, "unresolved-l1"),
        },
      }),
    ],
    [
      "an extra MakeID connection field",
      (printerId: string) => ({
        printerIds: [printerId],
        savedPrinterRecords: {
          [printerId]: {
            ...savedMakeIdPrinter(printerId),
            connection: {
              ...savedMakeIdPrinter(printerId).connection,
              commands: [1, 2, 3],
            },
          },
        },
      }),
    ],
  ])("rejects saved printer data with %s", async (_label, configuration) => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:valid";
    await writeFile(
      filePath,
      JSON.stringify({ version: 2, ...configuration(printerId) }),
      "utf8",
    );

    await expect(readSavedPrinterRecords(filePath)).rejects.toThrow(
      "saved printer configuration is invalid",
    );
  });

  it("rejects a transient profile before it writes the record", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    const printerId = "makeid:valid";

    await expect(
      writeConfiguredPrinterIds(
        filePath,
        [printerId],
        undefined,
        {},
        {
          [printerId]: savedMakeIdPrinter(printerId, "unresolved-p31"),
        },
      ),
    ).rejects.toThrow(`Saved printer record is invalid: ${printerId}`);
  });

  it("rejects malformed stored printer data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    await writeFile(filePath, '{"version":1,"printerIds":', "utf8");

    await expect(readConfiguredPrinterIds(filePath)).rejects.toThrow(
      SyntaxError,
    );
  });

  it.each([
    ["a darkness above the MakeID limit", { darkness: 32 }],
    ["a negative darkness", { darkness: -1 }],
    ["a fractional darkness", { darkness: 20.5 }],
    ["a nonnumeric darkness", { darkness: "20" }],
    ["a zero print-head size", { printHeadSizeMm: 0 }],
    ["a negative top margin", { marginTopMm: -0.1 }],
    ["a margin outside 0.1 mm steps", { marginBottomMm: 1.25 }],
    ["spacing outside 0.1 mm steps", { interLabelSpacingMm: 1.25 }],
    ["a blank display name", { displayName: "   " }],
    ["an untrimmed display name", { displayName: " Studio printer " }],
    ["a display name above its limit", { displayName: "x".repeat(81) }],
    ["an unknown setting", { darkness: 20, density: 3 }],
  ])("rejects restored settings with %s", async (_label, settings) => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    await writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        printerIds: ["makeid:valid"],
        printerSettings: { "makeid:valid": settings },
      }),
      "utf8",
    );

    await expect(readPrinterSettings(filePath)).rejects.toThrow(
      "saved printer configuration is invalid",
    );
  });
});
