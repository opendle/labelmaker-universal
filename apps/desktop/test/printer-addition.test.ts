import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import { openPrinterForAddition } from "../src/main/printer-addition.js";

const printer: PrinterDescriptor = {
  id: "makeid:macos-bt-0123456789abcdef01234567",
  adapterId: "makeid",
  displayName: "YichipFPGA-test",
  transport: "bluetooth-classic",
  connection: {
    model: "E1",
    transportDeviceId: "macos-bt-0123456789abcdef01234567",
  },
};

describe("desktop printer addition", () => {
  it("reuses the selected discovery and does not require a status reply", async () => {
    const session = fakeSession();
    const discover = vi.fn<() => Promise<readonly PrinterDescriptor[]>>();
    const openSession = vi.fn(async () => session);

    await expect(
      openPrinterForAddition(
        printer.id,
        { get: () => printer },
        discover,
        openSession,
      ),
    ).resolves.toEqual({ descriptor: printer, session });
    expect(discover).not.toHaveBeenCalled();
    expect(openSession).toHaveBeenCalledWith(printer);
    expect(session.status).not.toHaveBeenCalled();
  });

  it("uses one fallback search when the selected result is not cached", async () => {
    const session = fakeSession();
    const discover = vi.fn(async () => [printer]);

    await expect(
      openPrinterForAddition(
        printer.id,
        { get: () => undefined },
        discover,
        async () => session,
      ),
    ).resolves.toEqual({ descriptor: printer, session });
    expect(discover).toHaveBeenCalledTimes(1);
  });
});

function fakeSession(): PrinterSession & {
  status: ReturnType<typeof vi.fn>;
} {
  return {
    printer,
    capabilities: async () => {
      throw new Error("not used");
    },
    status: vi.fn(async () => {
      throw new Error("A transient status reply must not block pairing");
    }),
    print: async () => undefined,
    close: async () => undefined,
  };
}
