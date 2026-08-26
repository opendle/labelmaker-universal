import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
  PrinterDiscoveryCache,
  shouldProbePrinterStatus,
  summarizePrinter,
} from "../src/main/printer-summary.js";

const printer: PrinterDescriptor = {
  id: "makeid:paired-test",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: { model: "E1", transportDeviceId: "opaque-test" },
};

describe("desktop printer summaries", () => {
  it("keeps the exact descriptor from the last explicit search", () => {
    const cache = new PrinterDiscoveryCache();
    const replacement = { ...printer, displayName: "Replacement" };

    cache.replace([printer]);
    expect(cache.get(printer.id)).toBe(printer);
    cache.replace([replacement]);
    expect(cache.get(printer.id)).toBe(replacement);
    cache.delete(printer.id);
    expect(cache.get(printer.id)).toBeUndefined();
  });

  it("does not probe a cached session while its print job is active", () => {
    expect(shouldProbePrinterStatus("makeid", true, true)).toBe(false);
    expect(shouldProbePrinterStatus("makeid", true, false)).toBe(true);
    expect(shouldProbePrinterStatus("makeid", false, false)).toBe(false);
  });

  it("does not take the RFCOMM channel only to list a paired printer", async () => {
    const getSession = vi.fn(async () => fakeSession());
    const summary = await summarizePrinter(
      printer,
      "MakeID E1",
      getSession,
      async () => undefined,
      {
        probe: false,
        offlineCapabilities: {
          dpi: 203,
          rasterWidthPixels: 96,
          printableWidthMm: 12,
          darkness: {
            minimum: 0,
            maximum: 31,
            step: 1,
            defaultValue: 20,
          },
        },
        settings: { darkness: 24 },
      },
    );

    expect(summary).toMatchObject({
      id: printer.id,
      state: "disconnected",
      statusMessage: "Connects when you print",
      dpi: 203,
      printableWidthMm: 12,
      darkness: { value: 24 },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("reports an active job without sending a concurrent status query", async () => {
    const getSession = vi.fn(async () => fakeSession());
    const summary = await summarizePrinter(
      printer,
      "MakeID E1",
      getSession,
      async () => undefined,
      {
        probe: false,
        unprobedState: "busy",
        unprobedStatusMessage: "Printing",
      },
    );

    expect(summary).toMatchObject({ state: "busy", statusMessage: "Printing" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("reports a printer as unreachable when a live status query fails", async () => {
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
      state: "disconnected",
      statusMessage: "Not reachable",
    });
    expect(discard).toHaveBeenCalledWith(printer.id, session);
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
      printableWidthMm: 12,
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
