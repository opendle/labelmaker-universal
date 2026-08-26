import { describe, expect, it } from "vitest";

import {
  printerFailureMessage,
  remotePrinterFailureMessage,
} from "./printer-failure-message.js";

const fallback = "The printer operation failed.";

describe("printer failure messages", () => {
  it("extracts a safe adapter message from an Electron IPC error", () => {
    const error = new Error(
      "Error invoking remote method 'labelmaker:add-printer': MakeIdAdapterError: Forget the printer in macOS Bluetooth Settings, then add it again.",
    );

    expect(remotePrinterFailureMessage(error, fallback)).toBe(
      "Forget the printer in macOS Bluetooth Settings, then add it again.",
    );
  });

  it("does not expose an arbitrary Add Printer exception", () => {
    expect(
      remotePrinterFailureMessage(new Error("internal detail"), fallback),
    ).toBe(fallback);
  });

  it("uses the fallback for an empty or oversized message", () => {
    expect(printerFailureMessage(new Error(""), fallback)).toBe(fallback);
    expect(printerFailureMessage(new Error("x".repeat(241)), fallback)).toBe(
      fallback,
    );
  });
});
