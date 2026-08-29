// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { IpadMakeIdTransportProvider } from "./ipad-makeid-transport.js";

describe("iPad MakeID transport provider", () => {
  const requests: unknown[] = [];

  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            requests.push(request);
            const method = (request as { method?: unknown }).method;
            if (method === "bluetoothDiscover") {
              return { ok: true, result: [] };
            }
            return {
              ok: true,
              result: { connectionId: "ipad-ble-printer" },
            };
          },
        },
      },
    });
  });

  it("passes the discovery scope to the native bridge", async () => {
    const provider = new IpadMakeIdTransportProvider();

    await provider.discover({ timeoutMs: 2_500, includeUnpaired: true });

    expect(requests).toEqual([
      expect.objectContaining({
        method: "bluetoothDiscover",
        payload: { timeoutMs: 2_500, includeUnpaired: true },
      }),
    ]);
  });

  it("passes each protocol family to the native connection", async () => {
    const provider = new IpadMakeIdTransportProvider();

    await provider.connect("ipad-ble-printer", {
      protocolFamily: "abf0-66",
    });
    await provider.connect("ipad-ble-printer", {
      protocolFamily: "ff00-escpos",
    });

    expect(requests).toEqual([
      expect.objectContaining({
        method: "bluetoothConnect",
        payload: {
          deviceId: "ipad-ble-printer",
          protocolFamily: "abf0-66",
        },
      }),
      expect.objectContaining({
        method: "bluetoothConnect",
        payload: {
          deviceId: "ipad-ble-printer",
          protocolFamily: "ff00-escpos",
        },
      }),
    ]);
  });
});
