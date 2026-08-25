import { createBlankLabelDocument } from "@labelmaker/documents";
import type {
  PrintJob,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
} from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
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
  verticalMarginMm: 2,
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
    const renderPlate = vi.fn(async () => ({
      widthPixels: 96,
      heightPixels: 8,
      bytesPerRow: 12,
      data: new Uint8Array(96),
    }));
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
      mediaId: "makeid-e1-16mm-continuous",
    });
    expect(renderPlate).toHaveBeenCalledWith(plate, {
      dpi: 203,
      rasterWidthPixels: 96,
      verticalMarginMm: 2,
    });

    finishPrint?.();
    await expect(resultPromise).resolves.toEqual({
      message: "1 label sent to YichipFPGA-test",
    });
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
