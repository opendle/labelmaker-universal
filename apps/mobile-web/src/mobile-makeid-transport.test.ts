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

  it("cancels a native connection attempt without waiting for its timeout", async () => {
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
            if (message.method === "bluetoothCancel") {
              allowConnect();
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

    await expect(pending).rejects.toThrow("Canceled");
    expect(requests).toEqual([
      expect.objectContaining({ method: "bluetoothConnect" }),
      expect.objectContaining({
        method: "bluetoothCancel",
        payload: {},
      }),
    ]);
  });

  it("closes an in-flight native write when the print is canceled", async () => {
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    let rejectWrite!: (error: Error) => void;
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            requests.push(request);
            const message = request as { id: string; method: string };
            if (message.method === "bluetoothConnect") {
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: { connectionId: "active-connection" },
              };
            }
            if (message.method === "bluetoothWrite") {
              writeStarted();
              return new Promise((_, reject) => {
                rejectWrite = reject;
              });
            }
            if (message.method === "bluetoothClose") {
              rejectWrite(new Error("The connection was closed."));
              return {
                version: 1,
                id: message.id,
                ok: true,
                result: null,
              };
            }
            throw new Error(`Unexpected method ${message.method}`);
          },
        },
      },
    });
    const provider = new MobileMakeIdTransportProvider(createNativeBridge());
    const transport = await provider.connect("ipad-ble-printer", {
      protocolFamily: "abf0-66",
    });
    const controller = new AbortController();
    const pending = transport.write(Uint8Array.of(1, 2, 3), controller.signal);
    await started;

    controller.abort(new Error("Canceled"));

    await expect(pending).rejects.toThrow("Canceled");
    expect(transport.open).toBe(false);
    expect(requests.at(-1)).toEqual(
      expect.objectContaining({
        method: "bluetoothClose",
        payload: { connectionId: "active-connection" },
      }),
    );
  });
});
