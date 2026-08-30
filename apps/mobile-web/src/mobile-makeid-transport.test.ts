// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MobileMakeIdTransportProvider } from "./mobile-makeid-transport.js";
import { createNativeBridge } from "./native-bridge.js";

describe("iPad MakeID transport provider", () => {
  const requests: unknown[] = [];

  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            requests.push(request);
            const message = request as { id: string; method?: unknown };
            const method = message.method;
            if (method === "bluetoothDiscover") {
              return { version: 1, id: message.id, ok: true, result: [] };
            }
            return {
              version: 1,
              id: message.id,
              ok: true,
              result: { connectionId: "ipad-ble-printer" },
            };
          },
        },
      },
    });
  });

  it("passes the discovery scope to the native bridge", async () => {
    const provider = new MobileMakeIdTransportProvider(createNativeBridge());

    await provider.discover({ timeoutMs: 2_500, includeUnpaired: true });

    expect(requests).toEqual([
      expect.objectContaining({
        method: "bluetoothDiscover",
        payload: { timeoutMs: 2_500, includeUnpaired: true },
      }),
    ]);
  });

  it("passes each protocol family to the native connection", async () => {
    const provider = new MobileMakeIdTransportProvider(createNativeBridge());

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

  it("closes a native connection that completes after cancellation", async () => {
    let finishConnect!: () => void;
    const connectionStarted = new Promise<void>((resolve) => {
      finishConnect = resolve;
    });
    let allowConnect!: () => void;
    const connectBarrier = new Promise<void>((resolve) => {
      allowConnect = resolve;
    });
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            requests.push(request);
            const message = request as { id: string; method: string };
            if (message.method === "bluetoothConnect") {
              finishConnect();
              await connectBarrier;
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { connectionId: "late-connection" },
              };
            }
            return {
              version: 1,
              id: message.id,
              ok: true,
              result: null,
            };
          },
        },
      },
    });
    const controller = new AbortController();
    const provider = new MobileMakeIdTransportProvider(createNativeBridge());
    const pending = provider.connect(
      "ipad-ble-printer",
      { protocolFamily: "abf0-66" },
      controller.signal,
    );
    await connectionStarted;

    controller.abort(new Error("Canceled"));
    allowConnect();

    await expect(pending).rejects.toThrow("Canceled");
    expect(requests).toEqual([
      expect.objectContaining({ method: "bluetoothConnect" }),
      expect.objectContaining({
        method: "bluetoothClose",
        payload: { connectionId: "late-connection" },
      }),
    ]);
  });
});
