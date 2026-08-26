import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { DiscoveryOptions } from "@labelmaker/printing";

import {
  MakeIdTransportTimeoutError,
  type MakeIdTransport,
  type MakeIdTransportDevice,
  type MakeIdTransportProvider,
  type MakeIdTransportReadOptions,
} from "./transport.js";

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
const DEFAULT_TOTAL_CONNECT_TIMEOUT_MS = 30_000;
const CONNECT_ATTEMPTS = 2;
const CONNECT_RETRY_DELAYS_MS = [3_000] as const;
const CLOSE_GRACE_MS = 2_000;
const MAX_DISCOVERY_OUTPUT_BYTES = 1024 * 1024;
const MAKEID_FRAME_MARKER = 0x66;
const MIN_INBOUND_FRAME_BYTES = 6;
const MAX_INBOUND_FRAME_BYTES = 4_096;
const MAX_INBOUND_BUFFER_BYTES = MAX_INBOUND_FRAME_BYTES * 2;

export interface MacOsMakeIdTransportProviderOptions {
  readonly helperPath?: string;
  readonly helperArguments?: readonly string[];
  readonly connectTimeoutMs?: number;
  readonly totalConnectTimeoutMs?: number;
}

/** CoreBluetooth transport with a legacy Classic fallback on macOS. */
export class MacOsMakeIdTransportProvider implements MakeIdTransportProvider {
  readonly #helperPath: string;
  readonly #helperArguments: readonly string[];
  readonly #connectTimeoutMs: number;
  readonly #totalConnectTimeoutMs: number;
  readonly #nativeDeviceIds = new Map<string, string>();

  constructor(options: MacOsMakeIdTransportProviderOptions = {}) {
    if (process.platform !== "darwin" && options.helperPath === undefined) {
      throw new Error("The MakeID macOS transport requires macOS");
    }
    this.#helperPath =
      options.helperPath ??
      fileURLToPath(new URL("./bin/makeid-bluetooth-helper", import.meta.url));
    this.#helperArguments = options.helperArguments ?? [];
    this.#connectTimeoutMs =
      options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    this.#totalConnectTimeoutMs =
      options.totalConnectTimeoutMs ?? DEFAULT_TOTAL_CONNECT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.#connectTimeoutMs) ||
      this.#connectTimeoutMs < 1
    ) {
      throw new RangeError("connectTimeoutMs must be a positive integer");
    }
    if (
      !Number.isInteger(this.#totalConnectTimeoutMs) ||
      this.#totalConnectTimeoutMs < 1
    ) {
      throw new RangeError("totalConnectTimeoutMs must be a positive integer");
    }
  }

  async discover(
    options: DiscoveryOptions,
  ): Promise<readonly MakeIdTransportDevice[]> {
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
      throw new RangeError("Discovery timeoutMs must be a positive integer");
    }
    throwIfAborted(options.signal);
    const child = this.#spawn([
      "discover",
      ...(options.includeUnpaired ? ["--include-unpaired"] : []),
    ]);
    const stdout: Buffer[] = [];
    let stdoutLength = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength <= MAX_DISCOVERY_OUTPUT_BYTES) stdout.push(chunk);
    });

    const result = await waitForExit(child, options.timeoutMs, options.signal);
    if (stdoutLength > MAX_DISCOVERY_OUTPUT_BYTES) {
      throw new Error("The MakeID Bluetooth discovery result is too large");
    }
    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() || "MakeID Bluetooth discovery failed",
      );
    }
    return parseDiscoveryOutput(Buffer.concat(stdout).toString("utf8")).map(
      (device) => {
        const id = platformDeviceId(device.id);
        this.#nativeDeviceIds.set(id, device.id);
        return device.name === undefined ? { id } : { id, name: device.name };
      },
    );
  }

  async connect(
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<MakeIdTransport> {
    const discoveredId = this.#nativeDeviceIds.get(deviceId);
    const helperDeviceId =
      discoveredId ??
      (isPlatformDeviceId(deviceId)
        ? deviceId.toLowerCase()
        : isBluetoothAddress(deviceId)
          ? normalizeBluetoothAddress(deviceId)
          : null);
    if (helperDeviceId === null) {
      throw new Error("The saved MakeID printer ID is invalid");
    }
    throwIfAborted(signal);
    let lastError: unknown;
    const deadline = Date.now() + this.#totalConnectTimeoutMs;
    for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
      let transport: MacOsMakeIdTransport | undefined;
      try {
        if (isCoreBluetoothDeviceId(helperDeviceId)) {
          await this.#warmUpCoreBluetooth(deadline, signal);
        }
        const remainingMs = this.#remainingConnectTime(deadline);
        transport = new MacOsMakeIdTransport(
          this.#spawn(["connect", helperDeviceId]),
        );
        await transport.waitUntilReady(
          Math.min(this.#connectTimeoutMs, remainingMs),
          signal,
        );
        return transport;
      } catch (error) {
        lastError = error;
        await transport?.close();
        if (attempt < CONNECT_ATTEMPTS && Date.now() < deadline) {
          const delayMs = Math.min(
            CONNECT_RETRY_DELAYS_MS[attempt - 1] ?? 5_000,
            Math.max(0, deadline - Date.now()),
          );
          await abortableDelay(delayMs, signal);
        }
        if (Date.now() >= deadline) break;
      }
    }
    throw lastError;
  }

  async #warmUpCoreBluetooth(
    deadline: number,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const child = this.#spawn(["discover", "--include-unpaired"]);
    let stdoutLength = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutLength += chunk.length;
    });

    const result = await waitForExit(
      child,
      this.#remainingConnectTime(deadline),
      signal,
    );
    if (stdoutLength > MAX_DISCOVERY_OUTPUT_BYTES) {
      throw new Error("The MakeID Bluetooth discovery result is too large");
    }
    if (result.code !== 0) {
      throw new Error("MakeID Bluetooth warm-up failed");
    }
  }

  #remainingConnectTime(deadline: number): number {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1) {
      throw new MakeIdTransportTimeoutError(this.#totalConnectTimeoutMs);
    }
    return remainingMs;
  }

  #spawn(arguments_: readonly string[]): ChildProcessWithoutNullStreams {
    return spawn(this.#helperPath, [...this.#helperArguments, ...arguments_], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  }
}

class MacOsMakeIdTransport implements MakeIdTransport {
  readonly #child: ChildProcessWithoutNullStreams;
  #buffer = Buffer.alloc(0);
  #open = true;
  #ready = false;
  #stderr = "";
  readonly #readWaiters = new Set<() => void>();
  readonly #stateWaiters = new Set<() => void>();

  constructor(child: ChildProcessWithoutNullStreams) {
    this.#child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#boundBuffer();
      this.#wake(this.#readWaiters);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.#stderr += chunk;
      if (this.#stderr.includes("READY\n")) this.#ready = true;
      this.#wake(this.#stateWaiters);
    });
    child.once("error", () => {
      this.#open = false;
      this.#wakeAll();
    });
    child.once("exit", () => {
      this.#open = false;
      this.#wakeAll();
    });
  }

  get open(): boolean {
    return this.#open && !this.#child.killed;
  }

  async waitUntilReady(timeoutMs: number, signal?: AbortSignal): Promise<void> {
    await this.#waitFor(
      this.#stateWaiters,
      () => this.#ready || !this.open,
      timeoutMs,
      signal,
    );
    if (!this.#ready) {
      throw new Error(
        cleanHelperError(this.#stderr) ||
          "The MakeID Bluetooth connection closed before it was ready",
      );
    }
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (!this.open)
      throw new Error("The MakeID Bluetooth connection is closed");
    if (bytes.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error("The write was cancelled"));
      };
      const cleanup = (): void => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      this.#child.stdin.write(bytes, (error) => {
        cleanup();
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async read(options: MakeIdTransportReadOptions): Promise<Uint8Array> {
    const frame = this.#takeFrame();
    if (frame) return frame;
    await this.#waitFor(
      this.#readWaiters,
      () => this.#takeFrameLength() !== undefined || !this.open,
      options.timeoutMs,
      options.signal,
    );
    const completed = this.#takeFrame();
    if (completed) return completed;
    throw new Error(
      cleanHelperError(this.#stderr) ||
        "The MakeID Bluetooth connection closed while reading",
    );
  }

  async close(): Promise<void> {
    if (!this.#open && this.#child.exitCode !== null) return;
    this.#open = false;
    this.#child.stdin.end();
    this.#wakeAll();
    if (this.#child.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.#child.kill("SIGTERM");
        resolve();
      }, CLOSE_GRACE_MS);
      this.#child.once("exit", finish);
    });
  }

  #takeFrameLength(): number | undefined {
    while (this.#buffer.length > 0) {
      const markerIndex = this.#buffer.indexOf(MAKEID_FRAME_MARKER);
      if (markerIndex < 0) {
        this.#buffer = Buffer.alloc(0);
        return undefined;
      }
      if (markerIndex > 0) {
        this.#buffer = this.#buffer.subarray(markerIndex);
      }
      if (this.#buffer.length < 3) return undefined;

      const length = (this.#buffer[1] ?? 0) | ((this.#buffer[2] ?? 0) << 8);
      if (
        length < MIN_INBOUND_FRAME_BYTES ||
        length > MAX_INBOUND_FRAME_BYTES
      ) {
        this.#buffer = this.#buffer.subarray(1);
        continue;
      }
      if (this.#buffer.length >= length) return length;

      const nextCompleteFrame = this.#findCompleteFrame(1);
      if (nextCompleteFrame !== undefined) {
        this.#buffer = this.#buffer.subarray(nextCompleteFrame);
        continue;
      }
      return undefined;
    }
    return undefined;
  }

  #findCompleteFrame(start: number): number | undefined {
    let markerIndex = this.#buffer.indexOf(MAKEID_FRAME_MARKER, start);
    while (markerIndex >= 0) {
      if (this.#buffer.length - markerIndex < 3) return undefined;
      const length =
        (this.#buffer[markerIndex + 1] ?? 0) |
        ((this.#buffer[markerIndex + 2] ?? 0) << 8);
      if (
        length >= MIN_INBOUND_FRAME_BYTES &&
        length <= MAX_INBOUND_FRAME_BYTES &&
        this.#buffer.length - markerIndex >= length
      ) {
        return markerIndex;
      }
      markerIndex = this.#buffer.indexOf(MAKEID_FRAME_MARKER, markerIndex + 1);
    }
    return undefined;
  }

  #boundBuffer(): void {
    if (this.#buffer.length <= MAX_INBOUND_BUFFER_BYTES) return;
    const usefulStart = this.#buffer.length - MAX_INBOUND_FRAME_BYTES;
    const markerIndex = this.#buffer.indexOf(MAKEID_FRAME_MARKER, usefulStart);
    this.#buffer =
      markerIndex >= 0 ? this.#buffer.subarray(markerIndex) : Buffer.alloc(0);
  }

  #takeFrame(): Uint8Array | undefined {
    const length = this.#takeFrameLength();
    if (length === undefined) return undefined;
    const frame = this.#buffer.subarray(0, length);
    this.#buffer = this.#buffer.subarray(length);
    return Uint8Array.from(frame);
  }

  async #waitFor(
    waiters: Set<() => void>,
    condition: () => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    if (condition()) return;
    await new Promise<void>((resolve, reject) => {
      const notify = (): void => {
        if (condition()) finish();
      };
      const finish = (): void => {
        cleanup();
        resolve();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new MakeIdTransportTimeoutError(timeoutMs));
      }, timeoutMs);
      const abort = (): void => {
        cleanup();
        reject(signal?.reason ?? new Error("The operation was cancelled"));
      };
      const cleanup = (): void => {
        clearTimeout(timeout);
        waiters.delete(notify);
        signal?.removeEventListener("abort", abort);
      };
      waiters.add(notify);
      signal?.addEventListener("abort", abort, { once: true });
      notify();
    });
  }

  #wake(waiters: Set<() => void>): void {
    for (const waiter of [...waiters]) waiter();
  }

  #wakeAll(): void {
    this.#wake(this.#readWaiters);
    this.#wake(this.#stateWaiters);
  }
}

export function parseDiscoveryOutput(
  output: string,
): readonly MakeIdTransportDevice[] {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed)) {
    throw new TypeError(
      "The MakeID Bluetooth discovery result must be an array",
    );
  }
  return parsed.map((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !isNativeDeviceId(item.id) ||
      ("name" in item &&
        item.name !== undefined &&
        typeof item.name !== "string")
    ) {
      throw new TypeError("The MakeID Bluetooth discovery result is invalid");
    }
    const id = normalizeNativeDeviceId(item.id);
    return "name" in item && typeof item.name === "string"
      ? { id, name: item.name }
      : { id };
  });
}

function isBluetoothAddress(value: string): boolean {
  return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value);
}

function normalizeBluetoothAddress(address: string): string {
  return address.replaceAll("-", ":").toUpperCase();
}

function classicOpaqueDeviceId(address: string): string {
  return `macos-bt-${createHash("sha256").update(address.toUpperCase()).digest("hex").slice(0, 24)}`;
}

function isClassicOpaqueDeviceId(value: string): boolean {
  return /^macos-bt-[0-9a-f]{24}$/i.test(value);
}

function isCoreBluetoothDeviceId(value: string): boolean {
  return /^macos-ble-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

function isPlatformDeviceId(value: string): boolean {
  return isCoreBluetoothDeviceId(value) || isClassicOpaqueDeviceId(value);
}

function isNativeDeviceId(value: string): boolean {
  return isPlatformDeviceId(value) || isBluetoothAddress(value);
}

function normalizeNativeDeviceId(value: string): string {
  return isBluetoothAddress(value)
    ? normalizeBluetoothAddress(value)
    : value.toLowerCase();
}

function platformDeviceId(nativeDeviceId: string): string {
  return isBluetoothAddress(nativeDeviceId)
    ? classicOpaqueDeviceId(nativeDeviceId)
    : nativeDeviceId.toLowerCase();
}

function cleanHelperError(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => line && line !== "READY")
    .join("\n")
    .trim();
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ readonly code: number | null; readonly stderr: string }> {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    const finish = (code: number | null): void => {
      cleanup();
      resolve({ code, stderr });
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      fail(new MakeIdTransportTimeoutError(timeoutMs));
    }, timeoutMs);
    const abort = (): void => {
      child.kill("SIGTERM");
      fail(signal?.reason ?? new Error("The operation was cancelled"));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.removeListener("close", finish);
      child.removeListener("error", fail);
      signal?.removeEventListener("abort", abort);
    };
    child.once("close", finish);
    child.once("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("The operation was cancelled");
  }
}

async function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      cleanup();
      resolve();
    };
    const abort = (): void => {
      cleanup();
      reject(signal?.reason ?? new Error("The operation was cancelled"));
    };
    const timeout = setTimeout(finish, milliseconds);
    const cleanup = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
