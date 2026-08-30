// @vitest-environment jsdom

import { createBlankLabelDocument } from "@labelmaker/documents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpadPrinterService } from "./printer-service.js";

vi.mock("@labelmaker/rendering", () => ({
  renderPlateForPrinter: vi.fn(async () => ({
    widthPixels: 96,
    heightPixels: 1,
    bytesPerRow: 12,
    data: new Uint8Array(12),
  })),
}));

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
        model: "MakeID E1",
        dpi: 203,
        darkness: expect.objectContaining({ value: 20 }),
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
      version: 2,
      printerIds: [],
      activePrinterId: null,
      settings: {},
      printerRecords: {},
    });
  });

  it("restores a detected L1 300 DPI profile", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        version: 2,
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: {},
        printerRecords: {
          [PRINTER_ID]: {
            id: PRINTER_ID,
            adapterId: "makeid",
            displayName: "L1 workshop",
            model: "MakeID L1 300 DPI",
            transport: "bluetooth-low-energy",
            connection: {
              transportDeviceId: "ipad-ble-test-device",
              profileId: "l1-abf0-300",
              advertisedName: "L1 workshop",
            },
          },
        },
      }),
    );

    const service = new IpadPrinterService();

    await expect(service.listPrinters()).resolves.toEqual([
      expect.objectContaining({
        id: PRINTER_ID,
        model: "MakeID L1 300 DPI",
        dpi: 300,
        rasterWidthPixels: 144,
        rasterAlignment: "center",
        darkness: expect.objectContaining({ value: 20 }),
      }),
    ]);
  });

  it("rejects an unresolved profile in version 2 storage", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        version: 2,
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: {},
        printerRecords: {
          [PRINTER_ID]: {
            id: PRINTER_ID,
            adapterId: "makeid",
            displayName: "L1 workshop",
            transport: "bluetooth-low-energy",
            connection: {
              transportDeviceId: "ipad-ble-test-device",
              profileId: "unresolved-l1",
            },
          },
        },
      }),
    );

    const service = new IpadPrinterService();

    await expect(service.listPrinters()).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it("does not migrate a damaged version-2 profile as an E1", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        version: 2,
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: {},
        printerRecords: null,
      }),
    );

    const service = new IpadPrinterService();

    await expect(service.listPrinters()).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it("rejects darkness for an FF00 profile", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        version: 2,
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: {},
        printerRecords: {
          [PRINTER_ID]: {
            id: PRINTER_ID,
            adapterId: "makeid",
            displayName: "L1 workshop",
            model: "MakeID L1 300 DPI",
            transport: "bluetooth-low-energy",
            connection: {
              transportDeviceId: "ipad-ble-test-device",
              profileId: "l1-ff00-300",
            },
          },
        },
      }),
    );
    const service = new IpadPrinterService();

    await expect(
      service.updatePrinterSettings(PRINTER_ID, { darkness: 20 }),
    ).rejects.toThrow("does not support a darkness setting");
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
      "The iPhone or iPad host is not available.",
    );
  });

  it("closes the Add Printer probe before another discovery", async () => {
    const methods: string[] = [];
    const response = new Uint8Array(36);
    response.set([0x66, 36, 0, 0x10]);
    const bytesBase64 = btoa(String.fromCharCode(...response));
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            const method = (request as { method: string }).method;
            methods.push(method);
            if (method === "bluetoothDiscover") {
              return {
                ok: true,
                result: [{ id: "ipad-ble-test-device", name: "E124H00894" }],
              };
            }
            if (method === "bluetoothConnect") {
              return {
                ok: true,
                result: { connectionId: "ipad-ble-test-device" },
              };
            }
            if (method === "bluetoothRead") {
              return { ok: true, result: { bytesBase64 } };
            }
            return { ok: true, result: null };
          },
        },
      },
    });
    const service = new IpadPrinterService();

    await service.discoverPrinters();
    await service.addPrinter(PRINTER_ID);
    await service.discoverPrinters();

    expect(methods).toEqual([
      "bluetoothDiscover",
      "bluetoothConnect",
      "bluetoothWrite",
      "bluetoothRead",
      "bluetoothClose",
      "bluetoothDiscover",
    ]);
  });

  it("reuses one connection for sequential prints and closes it before discovery", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        version: 2,
        printerIds: [PRINTER_ID],
        activePrinterId: PRINTER_ID,
        settings: {},
        printerRecords: {
          [PRINTER_ID]: {
            id: PRINTER_ID,
            adapterId: "makeid",
            displayName: "MakeID E1",
            model: "MakeID E1",
            transport: "bluetooth-low-energy",
            connection: {
              transportDeviceId: "ipad-ble-test-device",
              profileId: "e1-abf0-203",
            },
          },
        },
      }),
    );
    const methods: string[] = [];
    const response = new Uint8Array(36);
    response.set([0x66, 36, 0, 0x10]);
    const bytesBase64 = btoa(String.fromCharCode(...response));
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            const method = (request as { method: string }).method;
            methods.push(method);
            if (method === "bluetoothDiscover") {
              return { ok: true, result: [] };
            }
            if (method === "bluetoothConnect") {
              return {
                ok: true,
                result: { connectionId: "ipad-ble-test-device" },
              };
            }
            if (method === "bluetoothRead") {
              return { ok: true, result: { bytesBase64 } };
            }
            return { ok: true, result: null };
          },
        },
      },
    });
    const document = createBlankLabelDocument(() => crypto.randomUUID());
    const plateId = document.plates[0]?.id;
    if (!plateId) throw new Error("Expected one plate");
    const request = {
      document,
      printerId: PRINTER_ID,
      plateIds: [plateId],
    };
    const service = new IpadPrinterService();

    await service.print(request);
    await service.print(request);

    expect(
      methods.filter((method) => method === "bluetoothConnect"),
    ).toHaveLength(1);
    expect(methods).not.toContain("bluetoothClose");

    await service.discoverPrinters();

    expect(methods.slice(-2)).toEqual(["bluetoothClose", "bluetoothDiscover"]);
  });
});
