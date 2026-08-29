import {
  MakeIdTransportTimeoutError,
  type MakeIdTransport,
  type MakeIdTransportConnectionOptions,
  type MakeIdTransportDevice,
  type MakeIdTransportProvider,
} from "@labelmaker/adapter-makeid";
import type { DiscoveryOptions } from "@labelmaker/printing";

import { base64ToBytes, bytesToBase64 } from "./base64.js";
import { callNative, isRecord, NativeBridgeError } from "./native-bridge.js";

export class IpadMakeIdTransportProvider implements MakeIdTransportProvider {
  async discover(
    options: DiscoveryOptions,
  ): Promise<readonly MakeIdTransportDevice[]> {
    throwIfAborted(options.signal);
    const response = await callNative("bluetoothDiscover", {
      timeoutMs: options.timeoutMs,
      includeUnpaired: options.includeUnpaired ?? false,
    });
    throwIfAborted(options.signal);
    if (!Array.isArray(response))
      throw new Error("Bluetooth discovery returned invalid data.");
    return response.map((value) => {
      if (!isRecord(value) || typeof value.id !== "string") {
        throw new Error("Bluetooth discovery returned an invalid printer.");
      }
      return {
        id: value.id,
        ...(typeof value.name === "string" ? { name: value.name } : {}),
      };
    });
  }

  async connect(
    deviceId: string,
    options: MakeIdTransportConnectionOptions,
    signal?: AbortSignal,
  ): Promise<MakeIdTransport> {
    throwIfAborted(signal);
    const response = await callNative("bluetoothConnect", {
      deviceId,
      protocolFamily: options.protocolFamily,
    });
    throwIfAborted(signal);
    if (!isRecord(response) || typeof response.connectionId !== "string") {
      throw new Error("Bluetooth connection returned invalid data.");
    }
    return new IpadMakeIdTransport(response.connectionId);
  }
}

class IpadMakeIdTransport implements MakeIdTransport {
  #open = true;

  constructor(private readonly connectionId: string) {}

  get open(): boolean {
    return this.#open;
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    await callNative("bluetoothWrite", {
      connectionId: this.connectionId,
      bytesBase64: bytesToBase64(bytes),
    });
    this.assertAvailable(signal);
  }

  async read(options: {
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
  }): Promise<Uint8Array> {
    this.assertAvailable(options.signal);
    try {
      const response = await callNative("bluetoothRead", {
        connectionId: this.connectionId,
        timeoutMs: options.timeoutMs,
      });
      this.assertAvailable(options.signal);
      if (!isRecord(response) || typeof response.bytesBase64 !== "string") {
        throw new Error("Bluetooth read returned invalid data.");
      }
      return base64ToBytes(response.bytesBase64);
    } catch (error) {
      if (
        error instanceof NativeBridgeError &&
        error.code === "BLUETOOTH_READ_TIMEOUT"
      ) {
        throw new MakeIdTransportTimeoutError(options.timeoutMs);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.#open) return;
    this.#open = false;
    await callNative("bluetoothClose", { connectionId: this.connectionId });
  }

  private assertAvailable(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (!this.#open) throw new Error("The MakeID transport is closed.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}
