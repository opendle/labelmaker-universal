import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
  getReadyPrinterSession,
  PrinterSessionManager,
} from "../src/main/printer-session.js";

const printer: PrinterDescriptor = {
  id: "makeid:test-printer",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: { model: "E1", transportDeviceId: "opaque-test" },
};

describe("desktop printer session cache", () => {
  it("shares one pending connection between callers", async () => {
    const opened = deferred<PrinterSession>();
    const session = fakeSession("ready");
    const connect = vi.fn(() => opened.promise);
    const manager = new PrinterSessionManager(connect);

    const first = manager.get(printer);
    const second = manager.get(printer);
    opened.resolve(session);

    await expect(Promise.all([first, second])).resolves.toEqual([
      session,
      session,
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("does not let an old rejected promise delete its replacement", async () => {
    const firstOpen = deferred<PrinterSession>();
    const secondOpen = deferred<PrinterSession>();
    const connect = vi
      .fn<() => Promise<PrinterSession>>()
      .mockReturnValueOnce(firstOpen.promise)
      .mockReturnValueOnce(secondOpen.promise);
    const manager = new PrinterSessionManager(connect);

    const first = manager.get(printer);
    const oldDiscard = manager.discard(printer.id);
    const second = manager.get(printer);
    const replacement = fakeSession("ready");
    secondOpen.resolve(replacement);
    firstOpen.reject(new Error("Old RFCOMM connection failed"));

    await expect(first).rejects.toThrow("Old RFCOMM connection failed");
    await oldDiscard;
    await expect(second).resolves.toBe(replacement);
    await expect(manager.get(printer)).resolves.toBe(replacement);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(replacement.close).not.toHaveBeenCalled();
  });

  it("closes a discarded pending session once without closing its replacement", async () => {
    const firstOpen = deferred<PrinterSession>();
    const stale = fakeSession("ready");
    const replacement = fakeSession("ready");
    const connect = vi
      .fn<() => Promise<PrinterSession>>()
      .mockReturnValueOnce(firstOpen.promise)
      .mockResolvedValueOnce(replacement);
    const manager = new PrinterSessionManager(connect);

    const first = manager.get(printer);
    const oldDiscard = manager.discard(printer.id);
    const second = manager.get(printer);
    firstOpen.resolve(stale);

    await expect(first).resolves.toBe(stale);
    await oldDiscard;
    await expect(second).resolves.toBe(replacement);
    await manager.discard(printer.id, stale);

    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(replacement.close).not.toHaveBeenCalled();
    await expect(manager.get(printer)).resolves.toBe(replacement);
  });

  it("closes each open session at most once during repeated cleanup", async () => {
    const session = fakeSession("ready");
    const manager = new PrinterSessionManager(async () => session);
    await manager.get(printer);

    await Promise.all([
      manager.discard(printer.id, session),
      manager.discard(printer.id, session),
      manager.closeAll(),
    ]);

    expect(session.close).toHaveBeenCalledTimes(1);
  });
});

describe("desktop printer readiness", () => {
  it("waits for busy and connecting states on the same healthy session", async () => {
    const session = fakeSession("ready");
    session.status = vi
      .fn()
      .mockResolvedValueOnce({ state: "connecting", message: "Opening" })
      .mockResolvedValueOnce({ state: "busy", message: "Starting" })
      .mockResolvedValueOnce({ state: "ready", message: "Ready" });
    const getSession = vi.fn(async () => session);
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard, {
        connectingRetryDelayMs: 0,
        busyRetryDelayMs: 0,
      }),
    ).resolves.toBe(session);
    expect(session.status).toHaveBeenCalledTimes(3);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it("stops a busy wait at one total deadline without reconnecting", async () => {
    const session = fakeSession("busy");
    const getSession = vi.fn(async () => session);
    const discard = vi.fn(async () => undefined);
    let now = 100;
    const sleep = vi.fn(async (delayMs: number) => {
      now += delayMs;
    });

    await expect(
      getReadyPrinterSession(printer, getSession, discard, {
        readinessTimeoutMs: 500,
        busyRetryDelayMs: 200,
        now: () => now,
        sleep,
      }),
    ).rejects.toThrow("Printing");
    expect(sleep.mock.calls).toEqual([[200], [200], [100]]);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
  });

  it("discards a disconnected session and reconnects once", async () => {
    const stale = fakeSession("disconnected");
    const fresh = fakeSession("ready");
    const getSession = vi
      .fn<() => Promise<PrinterSession>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard),
    ).resolves.toBe(fresh);
    expect(discard).toHaveBeenCalledWith(printer.id, stale);
  });

  it("discards a printer-error session and reconnects once", async () => {
    const stale = fakeSession("error");
    const fresh = fakeSession("ready");
    const getSession = vi
      .fn<() => Promise<PrinterSession>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard),
    ).resolves.toBe(fresh);
    expect(discard).toHaveBeenCalledWith(printer.id, stale);
  });

  it("reconnects once for attention and then reports the second state", async () => {
    const first = fakeSession("attention");
    const second = fakeSession("attention");
    const getSession = vi
      .fn<() => Promise<PrinterSession>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard),
    ).rejects.toThrow("Printer status is not available");
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledWith(printer.id, first);
  });

  it("retries when opening the Bluetooth session fails once", async () => {
    const fresh = fakeSession("ready");
    const getSession = vi
      .fn<() => Promise<PrinterSession>>()
      .mockRejectedValueOnce(new Error("RFCOMM closed"))
      .mockResolvedValueOnce(fresh);
    const discard = vi.fn(async () => undefined);

    await expect(
      getReadyPrinterSession(printer, getSession, discard),
    ).resolves.toBe(fresh);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(discard).not.toHaveBeenCalled();
  });
});

function fakeSession(
  state: "ready" | "busy" | "disconnected" | "attention" | "error",
): PrinterSession & { close: ReturnType<typeof vi.fn> } {
  return {
    printer,
    capabilities: async () => {
      throw new Error("not used");
    },
    status: vi.fn(async () => ({
      state,
      ...(state === "busy" ? { message: "Printing" } : {}),
      ...(state === "attention"
        ? { message: "Printer status is not available" }
        : {}),
    })),
    print: async () => undefined,
    close: vi.fn(async () => undefined),
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
