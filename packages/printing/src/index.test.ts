import { describe, expect, it } from "vitest";

import type {
  AdapterContext,
  DiscoveryOptions,
  PrinterAdapter,
} from "./index.js";
import { PrinterAdapterRegistry } from "./index.js";

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
