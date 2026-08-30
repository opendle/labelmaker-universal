// @vitest-environment jsdom

import { createBlankLabelDocument } from "@labelmaker/documents";
import type {
  AdapterContext,
  PrintJob,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
  PrinterStatus,
} from "@labelmaker/printing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNativeBridge } from "./native-bridge.js";
import { MobilePrinterService } from "./printer-service.js";

const fakes = vi.hoisted(() => ({
  connect: vi.fn(),
}));

vi.mock("@labelmaker/adapter-makeid", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@labelmaker/adapter-makeid")>();
  return {
    ...actual,
    MakeIdAdapter: class {
      readonly manifest = {
        id: "makeid",
        displayName: "MakeID",
        manufacturers: ["MakeID"],
        transports: ["bluetooth-low-energy"],
      } as const;
      readonly offlineCapabilities = {
        dpi: 203,
        rasterWidthPixels: 96,
        printableWidthMm: 12,
        rasterAlignment: "center",
      } as const;

      discover(): Promise<readonly PrinterDescriptor[]> {
        return Promise.resolve([]);
      }

      connect(
        printer: PrinterDescriptor,
        context: AdapterContext,
        signal?: AbortSignal,
      ): Promise<PrinterSession> {
        return fakes.connect(printer, context, signal);
      }
    },
  };
});

vi.mock("@labelmaker/rendering", () => ({
  renderPlateForPrinter: vi.fn(async () => ({
    widthPixels: 96,
    heightPixels: 1,
    bytesPerRow: 12,
    data: new Uint8Array(12),
  })),
}));

const CONFIGURATION_KEY = "labelmaker.android.printers.v1";
const PRINTER_ID = "makeid:android-ble-test-device";
const DESCRIPTOR: PrinterDescriptor = {
  id: PRINTER_ID,
  adapterId: "makeid",
  displayName: "MakeID E1",
  model: "MakeID E1",
  transport: "bluetooth-low-energy",
  connection: {
    transportDeviceId: "android-ble-test-device",
    profileId: "e1-abf0-203",
  },
};
const CAPABILITIES = {
  dpi: 203,
  rasterWidthPixels: 96,
  printableWidthMm: 12,
  rasterAlignment: "center",
  colorModes: ["monochrome"],
  media: [],
  maxCopies: 1,
  supportsCut: false,
  supportsStatus: true,
} satisfies PrinterCapabilities;
const READY_STATUS = { state: "ready" } satisfies PrinterStatus;

function storePrinter(): void {
  localStorage.setItem(
    CONFIGURATION_KEY,
    JSON.stringify({
      version: 2,
      printerIds: [PRINTER_ID],
      activePrinterId: PRINTER_ID,
      settings: {},
      printerRecords: { [PRINTER_ID]: DESCRIPTOR },
    }),
  );
}

function createService(): MobilePrinterService {
  return new MobilePrinterService(
    createNativeBridge(),
    CONFIGURATION_KEY,
    "android-ble",
  );
}

function createPrintRequest() {
  const document = createBlankLabelDocument(() => crypto.randomUUID());
  const plate = document.plates[0];
  if (!plate) throw new Error("Expected one label");
  return { document, printerId: PRINTER_ID, plateIds: [plate.id] };
}

describe("mobile print cancellation", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    storePrinter();
    fakes.connect.mockReset();
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: vi.fn(),
        },
      },
    });
  });

  it("aborts every print operation, discards the session, and reconnects", async () => {
    const signals: AbortSignal[] = [];
    const close = vi.fn().mockResolvedValue(undefined);
    const print = vi
      .fn()
      .mockImplementationOnce(
        (_job: PrintJob, _onProgress: unknown, signal?: AbortSignal) => {
          if (!signal) throw new Error("Expected a print signal");
          signals.push(signal);
          return new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        },
      )
      .mockResolvedValueOnce(undefined);
    const session: PrinterSession = {
      printer: DESCRIPTOR,
      capabilities: vi.fn(async (signal?: AbortSignal) => {
        if (!signal) throw new Error("Expected a capabilities signal");
        signals.push(signal);
        return CAPABILITIES;
      }),
      status: vi.fn(async (signal?: AbortSignal) => {
        if (!signal) throw new Error("Expected a status signal");
        signals.push(signal);
        return READY_STATUS;
      }),
      print,
      close,
    };
    fakes.connect.mockImplementation(
      async (
        _printer: PrinterDescriptor,
        _context: AdapterContext,
        signal?: AbortSignal,
      ) => {
        if (!signal) throw new Error("Expected a connect signal");
        signals.push(signal);
        return session;
      },
    );
    const service = createService();
    const request = createPrintRequest();

    const firstPrint = service.print(request);
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
    const cancellation = service.cancelPrint();

    await expect(firstPrint).rejects.toMatchObject({ name: "AbortError" });
    await cancellation;
    expect(signals).toHaveLength(4);
    expect(new Set(signals).size).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(close).toHaveBeenCalledOnce();

    await expect(service.print(request)).resolves.toEqual({
      message: "1 label sent to MakeID E1",
    });
    expect(fakes.connect).toHaveBeenCalledTimes(2);
    expect(print).toHaveBeenCalledTimes(2);
  });

  it("rejects a second print while the first print is active", async () => {
    let finish!: () => void;
    const session: PrinterSession = {
      printer: DESCRIPTOR,
      capabilities: vi.fn().mockResolvedValue(CAPABILITIES),
      status: vi.fn().mockResolvedValue(READY_STATUS),
      print: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
      close: vi.fn().mockResolvedValue(undefined),
    };
    fakes.connect.mockResolvedValue(session);
    const service = createService();
    const request = createPrintRequest();
    const firstPrint = service.print(request);
    await vi.waitFor(() => expect(session.print).toHaveBeenCalledOnce());

    await expect(service.print(request)).rejects.toThrow(
      "A print job is already active.",
    );
    finish();
    await firstPrint;
  });
});
