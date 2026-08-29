import { createBlankLabelDocument } from "@labelmaker/documents";
import type {
  PrintJob,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
} from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
  configuredPrinterDescriptors,
  findConfiguredPrintTarget,
  printToSession,
} from "../src/main/desktop-print.js";

const makeIdPrinter: PrinterDescriptor = {
  id: "makeid:macos-bt-opaque-test-id",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: { model: "E1", transportDeviceId: "opaque-test-id" },
};
const savedL1Printer: PrinterDescriptor = {
  id: "makeid:macos-ble-opaque-l1",
  adapterId: "makeid",
  displayName: "MAKEID-L1",
  model: "MakeID L1 300 dpi",
  transport: "bluetooth-low-energy",
  connection: {
    transportDeviceId: "macos-ble-opaque-l1",
    profileId: "l1-abf0-300",
    advertisedName: "MAKEID-L1",
  },
};
const mockPrinter: PrinterDescriptor = {
  id: "mock-studio",
  adapterId: "mock",
  displayName: "Studio Labeler",
  transport: "mock",
  connection: { fixture: "ready" },
};
const capabilities: PrinterCapabilities = {
  dpi: 203,
  rasterWidthPixels: 96,
  printableWidthMm: 12,
  darkness: { minimum: 0, maximum: 31, step: 1, defaultValue: 20 },
  colorModes: ["monochrome"],
  media: [
    {
      id: "makeid-e1-16mm-continuous",
      displayName: "16 mm continuous tape",
      widthMm: 16,
      continuous: true,
    },
  ],
  maxCopies: 9,
  supportsCut: false,
  supportsStatus: true,
};

describe("desktop physical print dispatch", () => {
  it("selects the exact configured MakeID target when a mock is listed first", () => {
    expect(
      findConfiguredPrintTarget(
        [mockPrinter, makeIdPrinter],
        new Set([makeIdPrinter.id]),
        makeIdPrinter.id,
      ),
    ).toBe(makeIdPrinter);
  });

  it("rebuilds a saved MakeID target when discovery returns no printer", () => {
    const printerId = "makeid:macos-bt-0123456789abcdef01234567";

    expect(configuredPrinterDescriptors([], new Set([printerId]))).toEqual([
      {
        id: printerId,
        adapterId: "makeid",
        displayName: "MakeID E1",
        transport: "bluetooth-classic",
        connection: {
          model: "E1",
          transportDeviceId: "macos-bt-0123456789abcdef01234567",
        },
      },
    ]);
  });

  it("rebuilds a saved MakeID BLE target after an application restart", () => {
    const printerId = "makeid:macos-ble-01234567-89ab-cdef-0123-456789abcdef";

    expect(configuredPrinterDescriptors([], new Set([printerId]))).toEqual([
      {
        id: printerId,
        adapterId: "makeid",
        displayName: "MakeID E1",
        transport: "bluetooth-low-energy",
        connection: {
          model: "E1",
          transportDeviceId: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
        },
      },
    ]);
  });

  it("does not rebuild a malformed saved MakeID BLE target", () => {
    const printerId = "makeid:macos-ble-not-a-peripheral-uuid";

    expect(configuredPrinterDescriptors([], new Set([printerId]))).toEqual([]);
  });

  it("restores a resolved model profile without nearby discovery", () => {
    expect(
      configuredPrinterDescriptors([], new Set([savedL1Printer.id]), {
        [savedL1Printer.id]: savedL1Printer,
      }),
    ).toEqual([savedL1Printer]);
  });

  it("keeps a saved profile when discovery returns an unresolved model", () => {
    const { model: _resolvedModel, ...unresolvedBase } = savedL1Printer;
    const unresolved: PrinterDescriptor = {
      ...unresolvedBase,
      connection: {
        transportDeviceId: "macos-ble-opaque-l1",
        profileId: "unresolved-l1",
        advertisedName: "MAKEID-L1",
      },
    };

    expect(
      configuredPrinterDescriptors([unresolved], new Set([savedL1Printer.id]), {
        [savedL1Printer.id]: savedL1Printer,
      }),
    ).toEqual([savedL1Printer]);
  });

  it("waits for the MakeID session and sends its exact printer ID", async () => {
    const document = createBlankLabelDocument(() => "test-id");
    const plate = document.plates[0];
    if (!plate) throw new Error("Expected one plate");
    let finishPrint: (() => void) | undefined;
    const print = vi.fn(
      (_job: PrintJob) =>
        new Promise<void>((resolve) => {
          finishPrint = resolve;
        }),
    );
    const session = fakeSession(makeIdPrinter, print);
    const rasterPage = {
      widthPixels: 96,
      heightPixels: 8,
      bytesPerRow: 12,
      data: new Uint8Array(96),
    };
    const renderPlate = vi.fn(async () => rasterPage);
    let settled = false;

    const resultPromise = printToSession(
      {
        document,
        printerId: makeIdPrinter.id,
        plateIds: [plate.id],
      },
      makeIdPrinter,
      session,
      renderPlate,
      () => "fixed-job-id",
      {
        displayName: "Shipping desk",
        darkness: 24,
        printHeadSizeMm: 11.8,
        marginTopMm: 1.4,
        marginBottomMm: 2.6,
      },
    ).then((result) => {
      settled = true;
      return result;
    });
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(print.mock.calls[0]?.[0]).toMatchObject({
      id: "fixed-job-id",
      printerId: makeIdPrinter.id,
      copies: 1,
      darkness: 24,
      mediaId: "makeid-e1-16mm-continuous",
    });
    expect(print.mock.calls[0]?.[0].pages[0]).toBe(rasterPage);
    expect(renderPlate).toHaveBeenCalledWith(plate, {
      dpi: 203,
      rasterWidthPixels: 96,
      printableWidthMm: 11.8,
      marginTopMm: 1.4,
      marginBottomMm: 2.6,
    });

    finishPrint?.();
    await expect(resultPromise).resolves.toEqual({
      message: "1 label sent to Shipping desk",
    });
    expect(makeIdPrinter.displayName).toBe("YichipFPGA-test");
  });

  it("adds the configured blank spacing only after a nonfinal page", async () => {
    const firstDocument = createBlankLabelDocument(() => "first");
    const firstPlate = firstDocument.plates[0];
    if (!firstPlate) throw new Error("Expected one plate");
    const secondPlate = { ...firstPlate, id: "second" };
    const document = {
      ...firstDocument,
      plates: [firstPlate, secondPlate],
    };
    const print = vi.fn(async (_job: PrintJob) => undefined);
    const session = fakeSession(makeIdPrinter, print);
    const firstPage = {
      widthPixels: 96,
      heightPixels: 2,
      bytesPerRow: 12,
      data: Uint8Array.from({ length: 24 }, () => 0xa5),
    };
    const secondPage = {
      widthPixels: 96,
      heightPixels: 3,
      bytesPerRow: 12,
      data: Uint8Array.from({ length: 36 }, () => 0x5a),
    };
    const renderPlate = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    await printToSession(
      {
        document,
        printerId: makeIdPrinter.id,
        plateIds: [firstPlate.id, secondPlate.id],
      },
      makeIdPrinter,
      session,
      renderPlate,
      () => "fixed-job-id",
      { interLabelSpacingMm: 1.5 },
    );

    const pages = print.mock.calls[0]?.[0].pages;
    expect(pages).toHaveLength(2);
    expect(pages?.[0]).toMatchObject({
      widthPixels: 96,
      bytesPerRow: 12,
      heightPixels: 14,
    });
    expect(pages?.[0]?.data.subarray(0, 24)).toEqual(firstPage.data);
    expect(pages?.[0]?.data.subarray(24)).toEqual(new Uint8Array(12 * 12));
    expect(pages?.[1]).toBe(secondPage);
  });

  it("rejects a session for a different printer before it can print", async () => {
    const document = createBlankLabelDocument(() => "test-id");
    const plate = document.plates[0];
    if (!plate) throw new Error("Expected one plate");
    const print = vi.fn<(job: PrintJob) => Promise<void>>();

    await expect(
      printToSession(
        {
          document,
          printerId: makeIdPrinter.id,
          plateIds: [plate.id],
        },
        makeIdPrinter,
        fakeSession(mockPrinter, print),
        vi.fn(),
      ),
    ).rejects.toThrow("session does not match");
    expect(print).not.toHaveBeenCalled();
  });
});

function fakeSession(
  printer: PrinterDescriptor,
  print: (job: PrintJob) => Promise<void>,
): PrinterSession {
  return {
    printer,
    capabilities: async () => capabilities,
    status: async () => ({ state: "ready" }),
    print,
    close: async () => undefined,
  };
}
