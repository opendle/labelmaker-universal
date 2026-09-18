// @vitest-environment jsdom

import { createBlankLabelDocument } from "@labelmaker/documents";
import { renderPlateForPrinter } from "@labelmaker/rendering";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNativeBridge } from "./native-bridge.js";
import { MobilePrinterService } from "./printer-service.js";

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

function createService(): MobilePrinterService {
  return new MobilePrinterService(
    createNativeBridge(),
    CONFIGURATION_KEY,
    "ipados",
  );
}

describe("iPad printer configuration", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            const message = request as { id: string; method: string };
            return {
              version: 1,
              id: message.id,
              ok: true,
              result: message.method === "bluetoothDiscover" ? [] : null,
            };
          },
        },
      },
    });
  });

  it("starts without a configured or active printer", async () => {
    const service = createService();

    await expect(service.listPrinters()).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it.each([undefined, 1, 2])(
    "preserves settings from configuration version %s after save and restart",
    async (version) => {
      const settings = {
        displayName: "Workshop printer",
        darkness: 24,
        printHeadSizeMm: 11.8,
        interLabelSpacingMm: 1.5,
        feedAfterPrintMm: 2.5,
        minimumLabelWidthMm: 22,
      };
      localStorage.setItem(
        CONFIGURATION_KEY,
        JSON.stringify({
          version,
          printerIds: [PRINTER_ID],
          activePrinterId: PRINTER_ID,
          settings: {
            [PRINTER_ID]: {
              ...settings,
              marginTopMm: 1.9,
              marginBottomMm: 0,
            },
          },
          printerRecords: {
            [PRINTER_ID]: {
              id: PRINTER_ID,
              adapterId: "makeid",
              displayName: "Stored printer",
              model: "E1",
              transport: "bluetooth-low-energy",
              connection: {
                transportDeviceId: "ipad-ble-test-device",
                profileId: "e1-abf0-203",
              },
            },
          },
        }),
      );
      const service = createService();
      const expectedSummary = {
        id: PRINTER_ID,
        name: settings.displayName,
        darkness: { value: settings.darkness },
        printableWidthMm: settings.printHeadSizeMm,
        interLabelSpacingMm: settings.interLabelSpacingMm,
        feedAfterPrintMm: settings.feedAfterPrintMm,
        minimumLabelWidthMm: settings.minimumLabelWidthMm,
        rasterAlignment: "center",
      };
      expect(service.getActivePrinterId()).toBe(PRINTER_ID);
      const initialSummary = (await service.listPrinters())[0]!;
      expect(initialSummary).toMatchObject(expectedSummary);
      expect(initialSummary).not.toHaveProperty("marginTopMm");
      expect(initialSummary).not.toHaveProperty("marginBottomMm");

      service.setActivePrinterId(PRINTER_ID);
      const saved = JSON.parse(localStorage.getItem(CONFIGURATION_KEY)!);
      expect(saved.version).toBe(2);
      expect(saved.settings).toEqual({ [PRINTER_ID]: settings });

      const restarted = createService();
      expect(restarted.getActivePrinterId()).toBe(PRINTER_ID);
      const summary = (await restarted.listPrinters())[0]!;
      expect(summary).toMatchObject(expectedSummary);
      expect(summary).not.toHaveProperty("marginTopMm");
      expect(summary).not.toHaveProperty("marginBottomMm");
    },
  );

  it("does not restore old mock printers", async () => {
    localStorage.setItem(
      CONFIGURATION_KEY,
      JSON.stringify({
        printerIds: ["mock-studio", PRINTER_ID],
        activePrinterId: "mock-studio",
        settings: {},
      }),
    );

    const service = createService();

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
    const service = createService();

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

    const service = createService();

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

    const service = createService();

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

    const service = createService();

    await expect(service.listPrinters()).resolves.toEqual([]);
    expect(service.getActivePrinterId()).toBeNull();
  });

  it("saves FF00 density and rejects values outside its range", async () => {
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
    const service = createService();

    await expect(
      service.updatePrinterSettings(PRINTER_ID, { darkness: 20 }),
    ).rejects.toThrow("outside its supported range");
    expect((await service.listPrinters())[0]?.feedAfterPrintMm).toBe(3);
    expect((await service.listPrinters())[0]?.minimumLabelWidthMm).toBe(22);
    await service.updatePrinterSettings(PRINTER_ID, {
      feedAfterPrintMm: 4.5,
      minimumLabelWidthMm: 16,
    });
    expect((await createService().listPrinters())[0]?.feedAfterPrintMm).toBe(
      4.5,
    );
    for (const darkness of [0, 1, 2]) {
      const printers = await service.updatePrinterSettings(PRINTER_ID, {
        darkness,
      });
      expect(printers[0]?.darkness?.value).toBe(darkness);
    }
  });

  it("rejects removal of a printer that is not configured", async () => {
    const service = createService();

    await expect(service.removePrinter(PRINTER_ID)).rejects.toThrow(
      "Printer is not configured.",
    );
  });

  it("reports a Bluetooth discovery failure", async () => {
    vi.stubGlobal("webkit", undefined);
    expect(() => createService()).toThrow("The mobile host is not available.");
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
            const message = request as { id: string; method: string };
            const method = message.method;
            methods.push(method);
            if (method === "bluetoothDiscover") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: [
                  {
                    id: "ipad-ble-test-device",
                    name: "E124H00894",
                    transport: "bluetooth-low-energy",
                  },
                ],
              };
            }
            if (method === "bluetoothConnect") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { connectionId: "ipad-ble-test-device" },
              };
            }
            if (method === "bluetoothRead") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { bytesBase64 },
              };
            }
            return { version: 1, id: message.id, ok: true, result: null };
          },
        },
      },
    });
    const service = createService();

    await service.discoverPrinters();
    await service.addPrinter(PRINTER_ID);
    await service.discoverPrinters();

    expect(methods).toEqual([
      "bluetoothDiscover",
      "bluetoothConnect",
      "bluetoothWrite",
      "bluetoothRead",
      "bluetoothClose",
      "bluetoothPreserve",
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
        settings: { [PRINTER_ID]: { marginTopMm: 0, marginBottomMm: 3 } },
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
    const rasterHeights: number[] = [];
    const response = new Uint8Array(36);
    response.set([0x66, 36, 0, 0x10]);
    const bytesBase64 = btoa(String.fromCharCode(...response));
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            const message = request as {
              id: string;
              method: string;
              payload: { bytesBase64: string };
            };
            const method = message.method;
            methods.push(method);
            if (method === "bluetoothWrite") {
              const bytes = Uint8Array.from(
                atob(message.payload.bytesBase64),
                (character) => character.charCodeAt(0),
              );
              if (bytes[3] === 0x1b)
                rasterHeights.push(bytes[11]! | (bytes[12]! << 8));
            }
            if (method === "bluetoothDiscover") {
              return { version: 1, id: message.id, ok: true, result: [] };
            }
            if (method === "bluetoothConnect") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { connectionId: "ipad-ble-test-device" },
              };
            }
            if (method === "bluetoothRead") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { bytesBase64 },
              };
            }
            return { version: 1, id: message.id, ok: true, result: null };
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
    const service = createService();

    vi.mocked(renderPlateForPrinter).mockClear();
    await service.print(request);
    expect(renderPlateForPrinter).toHaveBeenLastCalledWith(
      document.plates[0],
      {
        dpi: 203,
        rasterWidthPixels: 96,
        printableWidthMm: 12,
        rasterAlignment: "center",
      },
      expect.any(Function),
      expect.any(Function),
    );
    const initialSummary = (await service.listPrinters())[0]!;
    expect(initialSummary.printableWidthMm).toBe(12);
    expect(initialSummary).not.toHaveProperty("marginTopMm");
    expect(initialSummary).not.toHaveProperty("marginBottomMm");
    await service.updatePrinterSettings(PRINTER_ID, {
      printHeadSizeMm: 11.8,
      feedAfterPrintMm: 2.5,
      minimumLabelWidthMm: 16,
    });
    await service.print(request);
    expect(renderPlateForPrinter).toHaveBeenLastCalledWith(
      document.plates[0],
      {
        dpi: 203,
        rasterWidthPixels: 96,
        printableWidthMm: 11.8,
        rasterAlignment: "center",
      },
      expect.any(Function),
      expect.any(Function),
    );

    const saved = localStorage.getItem(CONFIGURATION_KEY)!;
    expect(saved).not.toContain("marginTopMm");
    expect(saved).not.toContain("marginBottomMm");
    const restarted = createService();
    expect(restarted.getActivePrinterId()).toBe(PRINTER_ID);
    const summary = (await restarted.listPrinters())[0]!;
    expect(summary).toMatchObject({
      printableWidthMm: 11.8,
      feedAfterPrintMm: 2.5,
      minimumLabelWidthMm: 16,
    });
    expect(summary).not.toHaveProperty("marginTopMm");
    expect(summary).not.toHaveProperty("marginBottomMm");
    expect(rasterHeights).toEqual([1, 148]);
    expect(
      methods.filter((method) => method === "bluetoothConnect"),
    ).toHaveLength(1);
    expect(methods).not.toContain("bluetoothClose");

    await service.discoverPrinters();

    expect(methods.slice(-2)).toEqual(["bluetoothClose", "bluetoothDiscover"]);
  });
});
