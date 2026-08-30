import type { DiscoveryOptions } from "@labelmaker/printing";

import type { MakeIdProtocolFamily } from "./models.js";

export interface MakeIdTransportDevice {
  /** An opaque device key which the platform transport can use to reconnect. */
  readonly id: string;
  readonly name?: string;
  readonly transport: "bluetooth-low-energy" | "bluetooth-classic";
}

export interface MakeIdTransportReadOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** A connected byte stream. Platform Bluetooth APIs belong behind this port. */
export interface MakeIdTransport {
  readonly open: boolean;
  write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
  read(options: MakeIdTransportReadOptions): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface MakeIdTransportProvider {
  discover(
    options: DiscoveryOptions,
  ): Promise<readonly MakeIdTransportDevice[]>;
  connect(
    deviceId: string,
    options: MakeIdTransportConnectionOptions,
    signal?: AbortSignal,
  ): Promise<MakeIdTransport>;
  /** Retain a transient discovery identity after the user saves a printer. */
  preserveDevice?(deviceId: string): Promise<void>;
  /** Release native identity state after the user removes a saved printer. */
  releaseDevice?(deviceId: string): Promise<void>;
}

export interface MakeIdTransportConnectionOptions {
  readonly protocolFamily: MakeIdProtocolFamily;
}

/** Deterministic transport for adapter tests and protocol capture tooling. */
export class RecordingMakeIdTransport implements MakeIdTransport {
  readonly writes: Uint8Array[] = [];
  readonly #responses: Uint8Array[];
  #open = true;

  constructor(responses: readonly Uint8Array[] = []) {
    this.#responses = responses.map((response) => response.slice());
  }

  get open(): boolean {
    return this.#open;
  }

  queueResponse(response: Uint8Array): void {
    this.#responses.push(response.slice());
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    assertTransportAvailable(this.#open, signal);
    this.writes.push(bytes.slice());
  }

  async read(options: MakeIdTransportReadOptions): Promise<Uint8Array> {
    assertTransportAvailable(this.#open, options.signal);
    const response = this.#responses.shift();
    if (!response) {
      throw new MakeIdTransportTimeoutError(options.timeoutMs);
    }
    return response.slice();
  }

  async close(): Promise<void> {
    this.#open = false;
  }
}

export class MakeIdTransportTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The MakeID transport did not receive data within ${timeoutMs} ms`);
    this.name = "MakeIdTransportTimeoutError";
  }
}

function assertTransportAvailable(open: boolean, signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
  if (!open) {
    throw new Error("The MakeID transport is closed");
  }
}
