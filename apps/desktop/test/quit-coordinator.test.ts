import { describe, expect, it, vi } from "vitest";

import { prepareToQuit } from "../src/main/quit-coordinator.js";

describe("desktop quit preparation", () => {
  it("finishes after recovery flush without waiting for printer close", async () => {
    const printerClose = new Promise<void>(() => undefined);
    const readyToQuit = vi.fn();

    prepareToQuit({
      closePrinters: () => printerClose,
      flushRecovery: () => Promise.resolve(),
      onPrinterCloseError: vi.fn(),
      onRecoveryError: vi.fn(),
      readyToQuit,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(readyToQuit).toHaveBeenCalledOnce();
  });

  it("reports errors and still finishes when recovery cannot be saved", async () => {
    const recoveryError = new Error("recovery failed");
    const printerError = new Error("close failed");
    const onRecoveryError = vi.fn();
    const onPrinterCloseError = vi.fn();
    const readyToQuit = vi.fn();

    prepareToQuit({
      closePrinters: () => Promise.reject(printerError),
      flushRecovery: () => Promise.reject(recoveryError),
      onPrinterCloseError,
      onRecoveryError,
      readyToQuit,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onPrinterCloseError).toHaveBeenCalledWith(printerError);
    expect(onRecoveryError).toHaveBeenCalledWith(recoveryError);
    expect(readyToQuit).toHaveBeenCalledOnce();
  });
});
