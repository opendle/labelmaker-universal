import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  initialConfiguredPrinterIds,
  mockPrintersEnabled,
  readConfiguredPrinterIds,
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
  });

  it("rejects corrupt stored printer data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "labelmaker-printers-"));
    const filePath = join(directory, "configured-printers.json");
    await writeConfiguredPrinterIds(filePath, ["makeid:valid"]);
    const invalid = `${filePath}.invalid`;
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(invalid, '{"version":1,"printerIds":["mock-studio"]}'),
    );

    await expect(readConfiguredPrinterIds(invalid)).rejects.toThrow(
      "saved printer configuration is invalid",
    );
  });
});
