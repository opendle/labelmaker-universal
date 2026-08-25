import type {
  AdapterContext,
  DiscoveryOptions,
  PrintJob,
  PrintProgress,
  PrinterAdapter,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
  PrinterStatus,
  RasterPage,
} from "@labelmaker/printing";

import {
  buildMakeIdControlFrame,
  buildMakeIdRasterFrame,
  encodeLzo1xLiteralStream,
  MakeIdControlState,
  MAKEID_BYTES_PER_LINE,
  MAKEID_PRINT_HEAD_PIXELS,
  parseMakeIdResponse,
  type MakeIdResponse,
} from "./protocol.js";
import {
  MakeIdTransportTimeoutError,
  type MakeIdTransport,
  type MakeIdTransportProvider,
} from "./transport.js";

export * from "./protocol.js";
export * from "./transport.js";

export const MAKEID_ADAPTER_ID = "makeid";

const DEFAULT_CHUNK_LINES = 170;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5_000;
const DEFAULT_COMPLETION_POLLS = 60;
const DEFAULT_COMPLETION_POLL_INTERVAL_MS = 500;
const MAKEID_E1_MAX_COPIES = 9;

const capabilities: PrinterCapabilities = {
  dpi: 203,
  rasterWidthPixels: MAKEID_PRINT_HEAD_PIXELS,
  colorModes: ["monochrome"],
  media: [
    {
      id: "makeid-e1-9mm-continuous",
      displayName: "9 mm continuous tape",
      widthMm: 9,
      continuous: true,
    },
    {
      id: "makeid-e1-12mm-continuous",
      displayName: "12 mm continuous tape",
      widthMm: 12,
      continuous: true,
    },
    {
      id: "makeid-e1-16mm-continuous",
      displayName: "16 mm continuous tape",
      widthMm: 16,
      continuous: true,
    },
  ],
  maxCopies: MAKEID_E1_MAX_COPIES,
  supportsCut: false,
  supportsStatus: true,
};

export type MakeIdAdapterErrorCode =
  | "makeid.cancelled"
  | "makeid.closed"
  | "makeid.invalid-printer"
  | "makeid.invalid-job"
  | "makeid.transport"
  | "makeid.timeout"
  | "makeid.protocol"
  | "makeid.not-ready"
  | "makeid.rejected";

export class MakeIdAdapterError extends Error {
  constructor(
    readonly code: MakeIdAdapterErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MakeIdAdapterError";
  }
}

export interface MakeIdE1AdapterOptions {
  /** Raw raster lines per protocol frame. Current captures support 170. */
  readonly chunkLines?: number;
  readonly responseTimeoutMs?: number;
  readonly completionPolls?: number;
  readonly completionPollIntervalMs?: number;
}

interface ResolvedOptions {
  readonly chunkLines: number;
  readonly responseTimeoutMs: number;
  readonly completionPolls: number;
  readonly completionPollIntervalMs: number;
}

interface MakeIdConnectionData {
  readonly [key: string]: unknown;
  readonly model: "E1";
  readonly transportDeviceId: string;
  readonly advertisedName?: string;
}

/**
 * First-pass MakeID E1 adapter.
 *
 * The injected provider owns OS discovery and Bluetooth Classic RFCOMM. This
 * package does not open a Bluetooth connection on its own.
 */
export class MakeIdE1Adapter implements PrinterAdapter {
  readonly manifest = {
    id: MAKEID_ADAPTER_ID,
    displayName: "MakeID E1",
    manufacturers: ["MakeID"],
    transports: ["bluetooth-classic"],
  } as const;

  readonly #options: ResolvedOptions;

  constructor(
    private readonly provider: MakeIdTransportProvider,
    options: MakeIdE1AdapterOptions = {},
  ) {
    this.#options = resolveOptions(options);
  }

  async discover(
    options: DiscoveryOptions,
    context: AdapterContext,
  ): Promise<readonly PrinterDescriptor[]> {
    throwIfAborted(options.signal);
    const devices = await this.provider.discover(options);
    throwIfAborted(options.signal);

    const matches = devices.filter(
      (device) => device.id.trim().length > 0 && isMakeIdE1Name(device.name),
    );
    context.log.debug("MakeID E1 discovery completed", {
      candidateCount: devices.length,
      matchCount: matches.length,
    });

    return matches.map((device) => {
      const connection: MakeIdConnectionData = device.name
        ? {
            model: "E1",
            transportDeviceId: device.id,
            advertisedName: device.name,
          }
        : { model: "E1", transportDeviceId: device.id };
      return {
        id: `${MAKEID_ADAPTER_ID}:${device.id}`,
        adapterId: MAKEID_ADAPTER_ID,
        displayName: device.name ?? "MakeID E1",
        transport: "bluetooth-classic",
        connection,
      };
    });
  }

  async connect(
    printer: PrinterDescriptor,
    context: AdapterContext,
    signal?: AbortSignal,
  ): Promise<PrinterSession> {
    throwIfAborted(signal);
    const connection = readConnection(printer);

    try {
      const transport = await this.provider.connect(
        connection.transportDeviceId,
        signal,
      );
      throwIfAborted(signal);
      context.log.info("MakeID E1 transport connected");
      return new MakeIdE1Session(printer, transport, context, this.#options);
    } catch (error) {
      throw normalizeAdapterError(error, signal);
    }
  }
}

export function isMakeIdE1Name(name: string | undefined): boolean {
  if (!name) {
    return false;
  }
  const normalized = name.trim().toLowerCase();
  return (
    normalized.startsWith("yichipfpga-") ||
    normalized === "makeid e1" ||
    normalized.startsWith("makeid e1-")
  );
}

export interface MakeIdE1PageEncodingOptions {
  readonly chunkLines?: number;
  readonly copies?: number;
  readonly darkness?: number;
}

/** Convert one validated 96-pixel raster into transport-ready `0x66` frames. */
export function encodeMakeIdE1Page(
  page: RasterPage,
  options: MakeIdE1PageEncodingOptions = {},
): readonly Uint8Array[] {
  validateRasterPage(page);
  const chunkLines = options.chunkLines ?? DEFAULT_CHUNK_LINES;
  assertPositiveInteger(chunkLines, "chunkLines");
  const copies = options.copies ?? 1;
  if (
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > MAKEID_E1_MAX_COPIES
  ) {
    throw invalidJob(`copies must be from 1 to ${MAKEID_E1_MAX_COPIES}`);
  }
  const darkness = options.darkness ?? 20;
  if (!Number.isInteger(darkness) || darkness < 0 || darkness > 31) {
    throw invalidJob("makeid.darkness must be an integer from 0 to 31");
  }

  const frameCount = Math.ceil(page.heightPixels / chunkLines);
  if (frameCount > 256) {
    throw invalidJob("The label needs more than 256 MakeID raster frames");
  }

  const frames: Uint8Array[] = [];
  for (
    let firstLine = 0;
    firstLine < page.heightPixels;
    firstLine += chunkLines
  ) {
    const lineCount = Math.min(chunkLines, page.heightPixels - firstLine);
    const firstByte = firstLine * page.bytesPerRow;
    const lastByte = firstByte + lineCount * page.bytesPerRow;
    const lzoPayload = encodeLzo1xLiteralStream(
      page.data.subarray(firstByte, lastByte),
    );
    frames.push(
      buildMakeIdRasterFrame(lzoPayload, {
        darkness,
        // These values match current E1 captures. Their names and behavior need
        // validation with continuous tape and the physical cutter button.
        mediaBits: 0x20,
        cutBits: 0x03,
        totalCopies: copies,
        currentCopy: 1,
        feedLengthPixels: page.heightPixels,
        lineCount,
        remainingFrames: frameCount - frames.length - 1,
      }),
    );
  }
  return frames;
}

class MakeIdE1Session implements PrinterSession {
  #closed = false;

  constructor(
    readonly printer: PrinterDescriptor,
    private readonly transport: MakeIdTransport,
    private readonly context: AdapterContext,
    private readonly options: ResolvedOptions,
  ) {}

  async capabilities(signal?: AbortSignal): Promise<PrinterCapabilities> {
    this.#assertOpen(signal);
    return capabilities;
  }

  async status(signal?: AbortSignal): Promise<PrinterStatus> {
    this.#assertOpen(signal);
    try {
      const response = await this.#query(signal);
      return mapResponseToStatus(response);
    } catch (error) {
      throw normalizeAdapterError(error, signal);
    }
  }

  async print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    this.#assertOpen(signal);
    validateJob(job, this.printer);
    const darkness = readDarkness(job.options);

    try {
      const initial = await this.#query(signal);
      if (initial.kind !== "success" || initial.printing) {
        throw new MakeIdAdapterError(
          "makeid.not-ready",
          "The MakeID E1 is not ready to print",
          true,
        );
      }

      for (let pageIndex = 0; pageIndex < job.pages.length; pageIndex += 1) {
        throwIfAborted(signal);
        const page = job.pages[pageIndex];
        if (!page) {
          throw invalidJob(`page ${pageIndex + 1} is missing`);
        }
        const frames = encodeMakeIdE1Page(page, {
          chunkLines: this.options.chunkLines,
          copies: job.copies,
          darkness,
        });

        for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
          const frame = frames[frameIndex];
          if (!frame) {
            throw invalidJob(`frame ${frameIndex + 1} is missing`);
          }
          await this.#sendRasterFrame(frame, signal);
        }

        await this.#waitForCompletion(signal);
        onProgress?.({
          completedPages: pageIndex + 1,
          totalPages: job.pages.length,
          message: `Printed label ${pageIndex + 1} of ${job.pages.length}`,
        });
      }

      // Public captures show state 0x03 after a completed transfer. Its exact
      // meaning may be "cancel", "finish", or "reset". Do not wait for a reply.
      await this.transport.write(
        buildMakeIdControlFrame(MakeIdControlState.CancelOrReset),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        await this.#sendBestEffortReset();
      }
      throw normalizeAdapterError(error, signal);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    await this.transport.close();
  }

  async #query(signal?: AbortSignal): Promise<MakeIdResponse> {
    await this.transport.write(
      buildMakeIdControlFrame(MakeIdControlState.Query),
      signal,
    );
    return this.#readResponse(signal);
  }

  async #readResponse(signal?: AbortSignal): Promise<MakeIdResponse> {
    const readOptions = signal
      ? { timeoutMs: this.options.responseTimeoutMs, signal }
      : { timeoutMs: this.options.responseTimeoutMs };
    const bytes = await this.transport.read(readOptions);
    return parseMakeIdResponse(bytes);
  }

  async #sendRasterFrame(
    frame: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.transport.write(frame, signal);
    let response = await this.#readResponse(signal);
    if (response.kind === "resend") {
      this.context.log.warn("MakeID E1 requested one raster-frame retry");
      await this.transport.write(frame, signal);
      response = await this.#readResponse(signal);
    }

    if (response.kind === "error") {
      throw new MakeIdAdapterError(
        "makeid.rejected",
        `The MakeID E1 rejected raster data with code ${response.errorCode}`,
        false,
      );
    }
    if (response.kind === "resend") {
      throw new MakeIdAdapterError(
        "makeid.rejected",
        "The MakeID E1 rejected a raster frame after one retry",
        true,
      );
    }
    if (response.kind === "paused" || response.kind === "exited") {
      throw new MakeIdAdapterError(
        "makeid.not-ready",
        "The MakeID E1 stopped the print transfer",
        true,
      );
    }
  }

  async #waitForCompletion(signal?: AbortSignal): Promise<void> {
    for (let poll = 0; poll < this.options.completionPolls; poll += 1) {
      throwIfAborted(signal);
      const response = await this.#query(signal);
      if (response.kind === "error") {
        throw new MakeIdAdapterError(
          "makeid.rejected",
          `The MakeID E1 reported print error ${response.errorCode}`,
          false,
        );
      }
      if (response.kind === "success" && !response.printing) {
        return;
      }
      await abortableDelay(this.options.completionPollIntervalMs, signal);
    }
    throw new MakeIdAdapterError(
      "makeid.timeout",
      "The MakeID E1 did not report print completion",
      true,
    );
  }

  async #sendBestEffortReset(): Promise<void> {
    if (!this.transport.open) {
      return;
    }
    try {
      await this.transport.write(
        buildMakeIdControlFrame(MakeIdControlState.CancelOrReset),
      );
    } catch {
      // The original cancellation error is more useful than a cleanup error.
    }
  }

  #assertOpen(signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (this.#closed || !this.transport.open) {
      throw new MakeIdAdapterError(
        "makeid.closed",
        "The MakeID E1 printer session is closed",
        false,
      );
    }
  }
}

function readConnection(printer: PrinterDescriptor): MakeIdConnectionData {
  if (
    printer.adapterId !== MAKEID_ADAPTER_ID ||
    printer.transport !== "bluetooth-classic"
  ) {
    throw new MakeIdAdapterError(
      "makeid.invalid-printer",
      "The printer descriptor does not belong to the MakeID E1 adapter",
      false,
    );
  }
  const model = printer.connection["model"];
  const transportDeviceId = printer.connection["transportDeviceId"];
  const advertisedName = printer.connection["advertisedName"];
  if (
    model !== "E1" ||
    typeof transportDeviceId !== "string" ||
    transportDeviceId.length === 0 ||
    (advertisedName !== undefined && typeof advertisedName !== "string")
  ) {
    throw new MakeIdAdapterError(
      "makeid.invalid-printer",
      "The MakeID E1 connection data is invalid",
      false,
    );
  }
  return typeof advertisedName === "string"
    ? { model, transportDeviceId, advertisedName }
    : { model, transportDeviceId };
}

function validateJob(job: PrintJob, printer: PrinterDescriptor): void {
  if (job.printerId !== printer.id) {
    throw invalidJob("The print job targets a different printer");
  }
  if (job.pages.length === 0) {
    throw invalidJob("A print job must contain at least one page");
  }
  if (
    !Number.isInteger(job.copies) ||
    job.copies < 1 ||
    job.copies > MAKEID_E1_MAX_COPIES
  ) {
    throw invalidJob(`copies must be from 1 to ${MAKEID_E1_MAX_COPIES}`);
  }
  if (
    job.mediaId !== undefined &&
    !capabilities.media.some((media) => media.id === job.mediaId)
  ) {
    throw invalidJob(`Unsupported MakeID E1 media: ${job.mediaId}`);
  }
  for (const page of job.pages) {
    validateRasterPage(page);
  }
}

function validateRasterPage(page: RasterPage): void {
  if (page.widthPixels !== MAKEID_PRINT_HEAD_PIXELS) {
    throw invalidJob(
      `MakeID E1 raster width must be ${MAKEID_PRINT_HEAD_PIXELS} pixels`,
    );
  }
  if (page.bytesPerRow !== MAKEID_BYTES_PER_LINE) {
    throw invalidJob(`MakeID E1 bytesPerRow must be ${MAKEID_BYTES_PER_LINE}`);
  }
  if (
    !Number.isInteger(page.heightPixels) ||
    page.heightPixels < 1 ||
    page.heightPixels > 0xffff
  ) {
    throw invalidJob("MakeID E1 raster height must be from 1 to 65535 pixels");
  }
  if (page.data.length !== page.bytesPerRow * page.heightPixels) {
    throw invalidJob(
      "MakeID E1 raster data length does not match its dimensions",
    );
  }
}

function readDarkness(options: PrintJob["options"]): number {
  const value = options?.["makeid.darkness"] ?? 20;
  if (
    !Number.isInteger(value) ||
    typeof value !== "number" ||
    value < 0 ||
    value > 31
  ) {
    throw invalidJob("makeid.darkness must be an integer from 0 to 31");
  }
  return value;
}

function mapResponseToStatus(response: MakeIdResponse): PrinterStatus {
  switch (response.kind) {
    case "success":
      return response.printing
        ? { state: "busy", message: "Printing" }
        : { state: "ready", message: "Ready" };
    case "wait":
      return { state: "busy", message: "Printer is busy" };
    case "paused":
      return { state: "attention", message: "Printer is paused" };
    case "exited":
      return { state: "disconnected", message: "Printer ended the session" };
    case "error":
      return {
        state: "error",
        message: `Printer reported error ${response.errorCode}`,
      };
    case "empty":
    case "resend":
      return { state: "attention", message: "Printer status is not available" };
  }
}

function resolveOptions(options: MakeIdE1AdapterOptions): ResolvedOptions {
  const resolved = {
    chunkLines: options.chunkLines ?? DEFAULT_CHUNK_LINES,
    responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
    completionPolls: options.completionPolls ?? DEFAULT_COMPLETION_POLLS,
    completionPollIntervalMs:
      options.completionPollIntervalMs ?? DEFAULT_COMPLETION_POLL_INTERVAL_MS,
  };
  assertPositiveInteger(resolved.chunkLines, "chunkLines");
  assertPositiveInteger(resolved.responseTimeoutMs, "responseTimeoutMs");
  assertPositiveInteger(resolved.completionPolls, "completionPolls");
  if (
    !Number.isInteger(resolved.completionPollIntervalMs) ||
    resolved.completionPollIntervalMs < 0
  ) {
    throw new Error("completionPollIntervalMs must be a non-negative integer");
  }
  return resolved;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function invalidJob(message: string): MakeIdAdapterError {
  return new MakeIdAdapterError("makeid.invalid-job", message, false);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new MakeIdAdapterError(
      "makeid.cancelled",
      "The MakeID print operation was cancelled",
      true,
    );
  }
}

function normalizeAdapterError(
  error: unknown,
  signal?: AbortSignal,
): MakeIdAdapterError {
  if (signal?.aborted) {
    return new MakeIdAdapterError(
      "makeid.cancelled",
      "The MakeID print operation was cancelled",
      true,
    );
  }
  if (error instanceof MakeIdAdapterError) {
    return error;
  }
  if (error instanceof MakeIdTransportTimeoutError) {
    return new MakeIdAdapterError(
      "makeid.timeout",
      "The MakeID E1 did not reply in time",
      true,
      { cause: error },
    );
  }
  if (error instanceof Error && error.name === "MakeIdProtocolError") {
    return new MakeIdAdapterError(
      "makeid.protocol",
      "The MakeID E1 returned an invalid protocol response",
      false,
      { cause: error },
    );
  }
  return new MakeIdAdapterError(
    "makeid.transport",
    "The MakeID E1 Bluetooth transport failed",
    true,
    { cause: error },
  );
}

async function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (milliseconds === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (): void => {
      if (signal) {
        signal.removeEventListener("abort", abort);
      }
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timeout);
      reject(
        new MakeIdAdapterError(
          "makeid.cancelled",
          "The MakeID print operation was cancelled",
          true,
        ),
      );
    };
    if (!signal) {
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
