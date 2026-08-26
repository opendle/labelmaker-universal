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
  readActivePrinterId,
  readConfiguredPrinterIds,
  readConfiguredPrinterIdsWithLegacy,
  readPrinterSettings,
  writeConfiguredPrinterIds,
} from "../src/main/printer-configuration.js";

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
    await writeConfiguredPrinterIds(legacyFilePath, [printerId]);

    expect(
      await readConfiguredPrinterIdsWithLegacy(filePath, legacyFilePath),
    ).toEqual([printerId]);
    expect(await readConfiguredPrinterIds(filePath)).toEqual([printerId]);
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
      [first]: { darkness: 24 },
      [second]: { darkness: 18 },
      "makeid:not-configured": { darkness: 31 },
    });

    expect(await readPrinterSettings(filePath)).toEqual({
      [first]: { darkness: 24 },
      [second]: { darkness: 18 },
    });
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
