import { describe, expect, it } from "vitest";

import type {
  AdapterContext,
  DiscoveryOptions,
  PrinterAdapter,
} from "./index.js";
import {
  PrinterAdapterRegistry,
  addInterLabelSpacing,
  isPrinterSettings,
} from "./index.js";

const adapter: PrinterAdapter = {
  manifest: {
    id: "fixture",
    displayName: "Fixture",
    manufacturers: ["Fixture"],
    transports: ["mock"],
  },
  async discover() {
    return [];
  },
  async connect() {
    throw new Error("Not used in this registry test");
  },
};

describe("PrinterAdapterRegistry", () => {
  it("registers and returns an adapter", () => {
    const registry = new PrinterAdapterRegistry();

    registry.register(adapter);

    expect(registry.get("fixture")).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
  });

  it("rejects a duplicate adapter ID", () => {
    const registry = new PrinterAdapterRegistry();
    registry.register(adapter);

    expect(() => registry.register(adapter)).toThrow("already registered");
  });

  it("rejects an unknown adapter ID", () => {
    const registry = new PrinterAdapterRegistry();

    expect(() => registry.get("missing")).toThrow("not registered");
  });
});

describe("DiscoveryOptions", () => {
  it("passes an explicit unpaired-device request to an adapter", async () => {
    let received: DiscoveryOptions | undefined;
    const discoveryAdapter: PrinterAdapter = {
      ...adapter,
      async discover(options) {
        received = options;
        return [];
      },
    };
    const context: AdapterContext = {
      log: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
    };

    await discoveryAdapter.discover(
      { timeoutMs: 250, includeUnpaired: true },
      context,
    );

    expect(received).toEqual({ timeoutMs: 250, includeUnpaired: true });
  });
});

describe("print job feed", () => {
  const page = {
    widthPixels: 8,
    heightPixels: 2,
    bytesPerRow: 1,
    data: Uint8Array.of(0x81, 0xff),
  };
  it("adds the final feed once and keeps inter-label spacing separate", () => {
    const pages = addInterLabelSpacing([page, page], 1, 254, 11);
    expect(pages.map((p) => p.heightPixels)).toEqual([12, 112]);
    expect(pages[0]?.data).toEqual(
      Uint8Array.from([0x81, 0xff, ...new Array(10).fill(0)]),
    );
    expect(pages[1]?.data).toEqual(
      Uint8Array.from([0x81, 0xff, ...new Array(110).fill(0)]),
    );
    expect(page.data).toEqual(Uint8Array.of(0x81, 0xff));
  });
  it("adds feed to a single label and permits zero feed", () => {
    expect(addInterLabelSpacing([page], 1, 254, 2)[0]?.heightPixels).toBe(22);
    expect(addInterLabelSpacing([page], 1, 254, 0)[0]).toBe(page);
    expect(addInterLabelSpacing([], 1, 254, 2)).toEqual([]);
  });
  it.each([-1, 100.1, 1.25, NaN, Infinity])(
    "rejects invalid final feed %s",
    (feedAfterPrintMm) => {
      expect(isPrinterSettings({ feedAfterPrintMm })).toBe(false);
      expect(() =>
        addInterLabelSpacing([page], 0, 254, feedAfterPrintMm),
      ).toThrow();
    },
  );
});
