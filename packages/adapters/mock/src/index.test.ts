import { describe, expect, it, vi } from "vitest";

import type { AdapterContext, RasterPage } from "@labelmaker/printing";

import { MockPrinterAdapter } from "./index.js";

const context: AdapterContext = {
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};

describe("MockPrinterAdapter", () => {
  it("discovers stable printer fixtures", async () => {
    const adapter = new MockPrinterAdapter();

    const printers = await adapter.discover({ timeoutMs: 100 }, context);

    expect(printers.map((printer) => printer.id)).toEqual([
      "mock-studio",
      "mock-workshop",
    ]);
  });

  it("reports progress for every raster page", async () => {
    const adapter = new MockPrinterAdapter();
    const [printer] = await adapter.discover({ timeoutMs: 100 }, context);
    if (!printer) {
      throw new Error("Expected a mock printer fixture");
    }
    const session = await adapter.connect(printer, context);
    const page: RasterPage = {
      widthPixels: 8,
      heightPixels: 1,
      bytesPerRow: 1,
      data: new Uint8Array([0]),
    };
    const progress = vi.fn();

    await session.print(
      { id: "job", printerId: printer.id, pages: [page, page], copies: 1 },
      progress,
    );

    expect(progress).toHaveBeenLastCalledWith({
      completedPages: 2,
      totalPages: 2,
    });
  });
});
