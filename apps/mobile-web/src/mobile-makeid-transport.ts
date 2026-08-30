import {
  MakeIdTransportTimeoutError,
  type MakeIdTransport,
  type MakeIdTransportConnectionOptions,
  type MakeIdTransportDevice,
  type MakeIdTransportProvider,
} from "@labelmaker/adapter-makeid";
import type { DiscoveryOptions } from "@labelmaker/printing";

import { base64ToBytes, bytesToBase64 } from "./base64.js";
import {
  isRecord,
  type NativeBridge,
  NativeBridgeError,
} from "./native-bridge.js";

export class MobileMakeIdTransportProvider implements MakeIdTransportProvider {
  constructor(private readonly bridge: NativeBridge) {}

  async discover(
    options: DiscoveryOptions,
  ): Promise<readonly MakeIdTransportDevice[]> {
    throwIfAborted(options.signal);
    const response = await this.bridge.call("bluetoothDiscover", {
      timeoutMs: options.timeoutMs,
      includeUnpaired: options.includeUnpaired ?? false,
    });
    throwIfAborted(options.signal);
    if (!Array.isArray(response))
      throw new Error("Bluetooth discovery returned invalid data.");
    return response.map((value) => {
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        value.transport !== "bluetooth-low-energy"
      ) {
        throw new Error("Bluetooth discovery returned an invalid printer.");
      }
      return {
        id: value.id,
        ...(typeof value.name === "string" ? { name: value.name } : {}),
        transport: value.transport,
      };
    });
  }

  async connect(
    deviceId: string,
    options: MakeIdTransportConnectionOptions,
    signal?: AbortSignal,
  ): Promise<MakeIdTransport> {
    throwIfAborted(signal);
    const response = await this.bridge.call("bluetoothConnect", {
      deviceId,
      protocolFamily: options.protocolFamily,
    });
    if (!isRecord(response) || typeof response.connectionId !== "string") {
      throw new Error("Bluetooth connection returned invalid data.");
    }
    const transport = new MobileMakeIdTransport(
      this.bridge,
      response.connectionId,
    );
    if (signal?.aborted) {
      await transport.close().catch(() => undefined);
      throw signal.reason;
    }
    return transport;
  }

  async preserveDevice(deviceId: string): Promise<void> {
    await this.bridge.call("bluetoothPreserve", { deviceId });
  }

  async releaseDevice(deviceId: string): Promise<void> {
    await this.bridge.call("bluetoothRelease", { deviceId });
  }
}

class MobileMakeIdTransport implements MakeIdTransport {
  #open = true;

  constructor(
    private readonly bridge: NativeBridge,
    private readonly connectionId: string,
  ) {}

  get open(): boolean {
    return this.#open;
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    this.assertAvailable(signal);
    await this.bridge.call("bluetoothWrite", {
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
      const response = await this.bridge.call("bluetoothRead", {
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
    await this.bridge.call("bluetoothClose", {
      connectionId: this.connectionId,
    });
  }

  private assertAvailable(signal?: AbortSignal): void {
    if (signal?.aborted) throw signal.reason;
    if (!this.#open) throw new Error("The MakeID transport is closed.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}
