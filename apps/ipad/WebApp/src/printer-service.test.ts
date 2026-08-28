// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpadPrinterService } from "./printer-service.js";

const CONFIGURATION_KEY = "labelmaker.ipados.printers.v1";
const PRINTER_ID = "makeid:ipad-ble-test-device";

describe("iPad printer configuration", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  it("starts without a configured or active printer", async () => {
    const service = new IpadPrinterService();

    await expect(service.listPrinters()).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it("does not restore old mock printers", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        printerIds: ["mock-studio", PRINTER_ID],
        activePrinterId: "mock-studio",
        settings: {},
      }),
    );

    const service = new IpadPrinterService();

    await expect(service.listPrinters()).resolves.toEqual([
      expect.objectContaining({
        id: PRINTER_ID,
        adapterId: "makeid",
        model: "E1",
      }),
    ]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it("removes the last printer and leaves no active printer", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: { [PRINTER_ID]: { displayName: "Workshop" } },
      }),
    );
    const service = new IpadPrinterService();

    await expect(service.removePrinter(PRINTER_ID)).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
    expect(
      JSON.parse(localStorage.getItem(CONFIGURATION_KEY) ?? "null"),
    ).toEqual({
      printerIds: [],
      activePrinterId: null,
      settings: {},
    });
  });

  it("rejects removal of a printer that is not configured", async () => {
    const service = new IpadPrinterService();

    await expect(service.removePrinter(PRINTER_ID)).rejects.toThrow(
      "Printer is not configured.",
    );
  });

  it("reports a Bluetooth discovery failure", async () => {
    vi.stubGlobal("webkit", undefined);
    const service = new IpadPrinterService();

    await expect(service.discoverPrinters()).rejects.toThrow(
      "The iPad host is not available.",
    );
  });
});
