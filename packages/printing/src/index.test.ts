import { describe, expect, it } from "vitest";

import type { PrinterAdapter } from "./index.js";
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
