import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import { getReadyPrinterSession } from "../src/main/printer-session.js";

const printer: PrinterDescriptor = {
  id: "makeid:test-printer",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: { model: "E1", transportDeviceId: "opaque-test" },
};

describe("desktop printer session recovery", () => {
  it("discards a stale session and reconnects before printing", async () => {
    const stale = fakeSession("disconnected");
    const fresh = fakeSession("ready");
    const sessions = [stale, fresh];
    const getSession = vi.fn(async () => {
      const session = sessions.shift();
      if (!session) throw new Error("No test session");
      return session;
    });
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard),
    ).resolves.toBe(fresh);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledWith(printer.id);
  });

  it("reports the last status error after bounded reconnect attempts", async () => {
    const session = fakeSession("busy");
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, async () => session, discard),
    ).rejects.toThrow("Printing");
    expect(discard).toHaveBeenCalledTimes(2);
  });

  it("retries when the Bluetooth connect operation itself fails once", async () => {
    const fresh = fakeSession("ready");
    let attempts = 0;
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(
        printer,
        async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("RFCOMM closed");
          return fresh;
        },
        discard,
      ),
    ).resolves.toBe(fresh);
    expect(attempts).toBe(2);
    expect(discard).toHaveBeenCalledWith(printer.id);
  });
});

function fakeSession(state: "ready" | "busy" | "disconnected"): PrinterSession {
  return {
    printer,
    capabilities: async () => {
      throw new Error("not used");
    },
    status: async () => ({
      state,
      ...(state === "busy" ? { message: "Printing" } : {}),
    }),
    print: async () => undefined,
    close: async () => undefined,
  };
}
