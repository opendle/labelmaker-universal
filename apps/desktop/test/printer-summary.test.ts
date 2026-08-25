import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import { summarizePrinter } from "../src/main/printer-summary.js";

const printer: PrinterDescriptor = {
  id: "makeid:paired-test",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: { model: "E1", transportDeviceId: "opaque-test" },
};

describe("desktop printer summaries", () => {
  it("does not take the RFCOMM channel only to list a paired printer", async () => {
    const getSession = vi.fn(async () => fakeSession());
    const summary = await summarizePrinter(
      printer,
      "MakeID E1",
      getSession,
      async () => undefined,
      { probe: false, verticalMarginMm: 2 },
    );

    expect(summary).toMatchObject({
      id: printer.id,
      state: "connecting",
      statusMessage: "Available",
      verticalMarginMm: 2,
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("keeps a printer available when a status query cannot open RFCOMM", async () => {
    const session = fakeSession();
    session.status = vi.fn(async () => {
      throw new Error("RFCOMM channel closed");
    });
    const discard = vi.fn(async () => undefined);
    const summary = await summarizePrinter(
      printer,
      "MakeID E1",
      async () => session,
      discard,
      { attempts: 1, retryDelayMs: 0 },
    );

    expect(summary).toMatchObject({
      id: printer.id,
      state: "connecting",
      statusMessage: "Available",
    });
    expect(discard).toHaveBeenCalledWith(printer.id);
  });

  it("refreshes status after a reconnect and reports the live printer", async () => {
    const first = fakeSession();
    first.status = vi.fn(async () => {
      throw new Error("RFCOMM channel closed");
    });
    const second = fakeSession();
    const sessions = [first, second];
    const summary = await summarizePrinter(
      printer,
      "MakeID E1",
      async () => {
        const session = sessions.shift();
        if (!session) throw new Error("No test session");
        return session;
      },
      async () => undefined,
      { attempts: 2, retryDelayMs: 0 },
    );

    expect(summary).toMatchObject({ state: "ready", statusMessage: "Ready" });
  });
});

function fakeSession(): PrinterSession {
  return {
    printer,
    capabilities: async () => ({
      dpi: 203,
      rasterWidthPixels: 96,
      verticalMarginMm: 2,
      colorModes: ["monochrome"],
      media: [],
      maxCopies: 1,
      supportsCut: false,
      supportsStatus: true,
    }),
    status: async () => ({ state: "ready", message: "Ready" }),
    print: async () => undefined,
    close: async () => undefined,
  };
}
