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
  parseMakeIdResponse,
  parseMakeIdAbf0Profile,
  type MakeIdResponse,
} from "./protocol.js";
import {
  buildMakeIdFf00RasterStream,
  MAKEID_FF00_BATTERY_QUERY,
  MAKEID_FF00_FIRMWARE_QUERY,
  MAKEID_FF00_MODEL_QUERY,
  MAKEID_FF00_SERIAL_QUERY,
  MAKEID_FF00_SESSION_CLOSE,
  MAKEID_FF00_SESSION_MODE,
  MAKEID_FF00_SESSION_OPEN,
  MAKEID_FF00_STATUS_QUERY,
  parseMakeIdFf00Model,
  replyStartsWith,
} from "./ff00-protocol.js";
import {
  candidateProtocolFamilies,
  capabilitiesForProfile,
  classifyMakeIdName,
  defaultProfileForId,
  MAKEID_E1_PROFILE,
  makeIdProfileId,
  offlineCapabilitiesForProfile,
  type MakeIdDiscoveryKind,
  type MakeIdProfileId,
  type MakeIdResolvedProfile,
} from "./models.js";
import {
  MakeIdTransportTimeoutError,
  type MakeIdTransport,
  type MakeIdTransportProvider,
} from "./transport.js";

export * from "./protocol.js";
export * from "./ff00-protocol.js";
export * from "./models.js";
export * from "./transport.js";

export const MAKEID_ADAPTER_ID = "makeid";

const DEFAULT_CHUNK_LINES = 170;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5_000;
const DEFAULT_COMPLETION_POLLS = 60;
const DEFAULT_COMPLETION_POLL_INTERVAL_MS = 500;

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

export interface MakeIdAdapterOptions {
  /** Raw raster lines per protocol frame. Current captures support 170. */
  readonly chunkLines?: number;
  readonly responseTimeoutMs?: number;
  readonly completionPolls?: number;
  readonly completionPollIntervalMs?: number;
}

/** Backward-compatible option name for the first E1-only release. */
export type MakeIdE1AdapterOptions = MakeIdAdapterOptions;

interface ResolvedOptions {
  readonly chunkLines: number;
  readonly responseTimeoutMs: number;
  readonly completionPolls: number;
  readonly completionPollIntervalMs: number;
}

interface MakeIdConnectionData {
  readonly [key: string]: unknown;
  readonly transportDeviceId: string;
  readonly profileId: MakeIdProfileId | "unresolved-l1" | "unresolved-p31";
  readonly advertisedName?: string;
}

/** Multi-model MakeID adapter with protocol selection behind one stable ID. */
export class MakeIdAdapter implements PrinterAdapter {
  readonly manifest = {
    id: MAKEID_ADAPTER_ID,
    displayName: "MakeID",
    manufacturers: ["MakeID"],
    transports: ["bluetooth-low-energy", "bluetooth-classic"],
  } as const;

  readonly #options: ResolvedOptions;

  constructor(
    private readonly provider: MakeIdTransportProvider,
    options: MakeIdAdapterOptions = {},
  ) {
    this.#options = resolveOptions(options);
  }

  offlineCapabilitiesFor(printer: PrinterDescriptor) {
    const profileId = printer.connection["profileId"];
    if (printer.connection["model"] === "E1") {
      return offlineCapabilitiesForProfile(MAKEID_E1_PROFILE);
    }
    return makeIdProfileId(profileId)
      ? offlineCapabilitiesForProfile(defaultProfileForId(profileId))
      : undefined;
  }

  async discover(
    options: DiscoveryOptions,
    context: AdapterContext,
  ): Promise<readonly PrinterDescriptor[]> {
    throwIfAborted(options.signal);
    const devices = await this.provider.discover(options);
    throwIfAborted(options.signal);

    const matches = devices.flatMap((device) => {
      const kind = classifyMakeIdName(device.name);
      return device.id.trim().length > 0 && kind ? [{ device, kind }] : [];
    });
    context.log.debug("MakeID discovery completed", {
      candidateCount: devices.length,
      matchCount: matches.length,
    });

    return matches.map(({ device, kind }) => {
      const profileId = discoveryProfileId(kind);
      const connection: MakeIdConnectionData = device.name
        ? {
            transportDeviceId: device.id,
            profileId,
            advertisedName: device.name,
          }
        : { transportDeviceId: device.id, profileId };
      return {
        id: `${MAKEID_ADAPTER_ID}:${device.id}`,
        adapterId: MAKEID_ADAPTER_ID,
        displayName: device.name ?? "MakeID printer",
        ...(kind === "e1" ? { model: "MakeID E1" } : {}),
        transport: /^(?:macos|ipad)-ble-/i.test(device.id)
          ? "bluetooth-low-energy"
          : "bluetooth-classic",
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
    const kind = connectionKind(connection);
    const families = makeIdProfileId(connection.profileId)
      ? [defaultProfileForId(connection.profileId).protocolFamily]
      : candidateProtocolFamilies(kind);
    let lastError: unknown;
    for (const protocolFamily of families) {
      let transport: MakeIdTransport | undefined;
      try {
        transport = await this.provider.connect(
          connection.transportDeviceId,
          { protocolFamily },
          signal,
        );
        throwIfAborted(signal);
        const profile =
          protocolFamily === "abf0-66"
            ? await probeAbf0Profile(
                transport,
                kind,
                connection.advertisedName,
                this.#options.responseTimeoutMs,
                signal,
              )
            : await probeFf00Profile(
                transport,
                this.#options.responseTimeoutMs,
                signal,
              );
        const resolvedPrinter = resolvedDescriptor(
          printer,
          connection,
          profile,
        );
        context.log.info("MakeID protocol connected", {
          model: profile.model,
          profileId: profile.profileId,
        });
        const Session =
          protocolFamily === "abf0-66" ? MakeId66Session : MakeIdFf00Session;
        return new Session(
          resolvedPrinter,
          transport,
          context,
          this.#options,
          profile,
        );
      } catch (error) {
        lastError = error;
        try {
          await transport?.close();
        } catch {
          // Continue to the next evidence-backed protocol candidate.
        }
      }
    }
    const normalized = normalizeAdapterError(lastError, signal);
    throw new MakeIdAdapterError(
      normalized.code,
      "Could not identify or connect to the MakeID printer. Turn it off and on, keep it nearby, and try again. If it still fails, remove the saved printer and add it again.",
      true,
      { cause: normalized },
    );
  }
}

/** Backward-compatible name for callers which used the original E1 adapter. */
export const MakeIdE1Adapter = MakeIdAdapter;

function discoveryProfileId(
  kind: MakeIdDiscoveryKind,
): MakeIdConnectionData["profileId"] {
  return kind === "e1"
    ? "e1-abf0-203"
    : kind === "l1"
      ? "unresolved-l1"
      : "unresolved-p31";
}

function connectionKind(connection: MakeIdConnectionData): MakeIdDiscoveryKind {
  if (connection.profileId.startsWith("e1-")) return "e1";
  if (
    connection.profileId.startsWith("l1-") ||
    connection.profileId === "unresolved-l1"
  ) {
    return "l1";
  }
  if (
    connection.profileId.startsWith("p31-") ||
    connection.profileId === "unresolved-p31"
  ) {
    return "p31";
  }
  const kind = classifyMakeIdName(connection.advertisedName);
  if (kind) return kind;
  throw new MakeIdAdapterError(
    "makeid.invalid-printer",
    "The saved MakeID model profile is invalid",
    false,
  );
}

function resolvedDescriptor(
  printer: PrinterDescriptor,
  connection: MakeIdConnectionData,
  profile: MakeIdResolvedProfile,
): PrinterDescriptor {
  return {
    ...printer,
    model: profile.model,
    connection: {
      transportDeviceId: connection.transportDeviceId,
      profileId: profile.profileId,
      ...(connection.advertisedName
        ? { advertisedName: connection.advertisedName }
        : {}),
    },
  };
}

async function probeAbf0Profile(
  transport: MakeIdTransport,
  kind: MakeIdDiscoveryKind,
  advertisedName: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MakeIdResolvedProfile> {
  await transport.write(
    buildMakeIdControlFrame(MakeIdControlState.Query),
    signal,
  );
  const response = await transport.read(
    signal ? { timeoutMs, signal } : { timeoutMs },
  );
  return parseMakeIdAbf0Profile(response, kind, advertisedName);
}

async function probeFf00Profile(
  transport: MakeIdTransport,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MakeIdResolvedProfile> {
  await transport.write(MAKEID_FF00_MODEL_QUERY, signal);
  const response = await transport.read(
    signal ? { timeoutMs, signal } : { timeoutMs },
  );
  return parseMakeIdFf00Model(response);
}

export function isMakeIdE1Name(name: string | undefined): boolean {
  return classifyMakeIdName(name) === "e1";
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
  return encodeMakeId66Page(page, MAKEID_E1_PROFILE, options);
}

/** Encode one ABF0/0x66 page with the detected model profile. */
export function encodeMakeId66Page(
  page: RasterPage,
  profile: MakeIdResolvedProfile,
  options: MakeIdE1PageEncodingOptions = {},
): readonly Uint8Array[] {
  validateRasterPage(page, profile);
  const chunkLines = Math.min(
    options.chunkLines ?? profile.maxRowsPerPacket,
    profile.maxRowsPerPacket,
  );
  assertPositiveInteger(chunkLines, "chunkLines");
  const copies = options.copies ?? 1;
  const maximumCopies = capabilitiesForProfile(profile).maxCopies;
  if (!Number.isInteger(copies) || copies < 1 || copies > maximumCopies) {
    throw invalidJob(`copies must be from 1 to ${maximumCopies}`);
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
    const raster = page.data.slice(firstByte, lastByte);
    if (profile.swapRasterBytePairs) swapAdjacentBytes(raster);
    const lzoPayload = encodeLzo1xLiteralStream(raster);
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

abstract class MakeIdSession implements PrinterSession {
  #closed = false;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(
    readonly printer: PrinterDescriptor,
    protected readonly transport: MakeIdTransport,
    protected readonly context: AdapterContext,
    protected readonly options: ResolvedOptions,
    protected readonly profile: MakeIdResolvedProfile,
  ) {}

  async capabilities(signal?: AbortSignal): Promise<PrinterCapabilities> {
    this.assertOpen(signal);
    return capabilitiesForProfile(this.profile);
  }

  abstract status(signal?: AbortSignal): Promise<PrinterStatus>;

  abstract print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;

  async close(): Promise<void> {
    return this.runExclusive(async () => {
      if (this.#closed) return;
      this.#closed = true;
      await this.transport.close();
    });
  }

  protected reportProgress(
    onProgress: ((progress: PrintProgress) => void) | undefined,
    progress: PrintProgress,
  ): void {
    try {
      onProgress?.(progress);
    } catch (error) {
      this.context.log.warn("The MakeID print progress callback failed.", {
        reason: adapterErrorReason(error),
      });
    }
  }

  protected assertOpen(signal?: AbortSignal): void {
    throwIfAborted(signal);
    if (this.#closed || !this.transport.open) {
      throw new MakeIdAdapterError(
        "makeid.closed",
        "The MakeID printer session is closed",
        false,
      );
    }
  }

  protected async invalidate(): Promise<void> {
    this.#closed = true;
    try {
      await this.transport.close();
    } catch {
      // Preserve the operation result which made the session unusable.
    }
  }

  protected async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#operationTail;
    let release: () => void = () => undefined;
    this.#operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class MakeId66Session extends MakeIdSession {
  async status(signal?: AbortSignal): Promise<PrinterStatus> {
    return this.runExclusive(async () => {
      this.assertOpen(signal);
      try {
        const response = await this.#query(signal);
        return mapResponseToStatus(response);
      } catch (error) {
        throw normalizeAdapterError(error, signal);
      }
    });
  }

  async print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.runExclusive(async () => {
      this.assertOpen(signal);
      validateJob(job, this.printer, this.profile);
      const darkness = readDarkness(job);

      try {
        const initial = await this.#query(signal);
        if (initial.kind !== "success" || initial.printing) {
          throw new MakeIdAdapterError(
            "makeid.not-ready",
            `The ${this.profile.model} is not ready to print`,
            true,
          );
        }

        for (let pageIndex = 0; pageIndex < job.pages.length; pageIndex += 1) {
          throwIfAborted(signal);
          const page = job.pages[pageIndex];
          if (!page) {
            throw invalidJob(`page ${pageIndex + 1} is missing`);
          }
          const frames = encodeMakeId66Page(page, this.profile, {
            chunkLines: Math.min(
              this.options.chunkLines,
              this.profile.maxRowsPerPacket,
            ),
            copies: job.copies,
            darkness,
          });

          for (
            let frameIndex = 0;
            frameIndex < frames.length;
            frameIndex += 1
          ) {
            const frame = frames[frameIndex];
            if (!frame) {
              throw invalidJob(`frame ${frameIndex + 1} is missing`);
            }
            await this.#sendRasterFrame(frame, signal);
          }

          await this.#waitForCompletion(signal);
          this.reportProgress(onProgress, {
            completedPages: pageIndex + 1,
            totalPages: job.pages.length,
            message: `Printed label ${pageIndex + 1} of ${job.pages.length}`,
          });
        }

        await this.#finishCompletedTransfer(signal);
      } catch (error) {
        if (signal?.aborted) {
          await this.#sendBestEffortReset();
        }
        throw normalizeAdapterError(error, signal);
      }
    });
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
      this.context.log.warn("MakeID requested one raster-frame retry");
      await this.transport.write(frame, signal);
      response = await this.#readResponse(signal);
    }

    if (response.kind === "error") {
      throw new MakeIdAdapterError(
        "makeid.rejected",
        `The ${this.profile.model} rejected raster data with code ${response.errorCode}`,
        false,
      );
    }
    if (response.kind === "resend") {
      throw new MakeIdAdapterError(
        "makeid.rejected",
        `The ${this.profile.model} rejected a raster frame after one retry`,
        true,
      );
    }
    if (response.kind === "paused" || response.kind === "exited") {
      throw new MakeIdAdapterError(
        "makeid.not-ready",
        `The ${this.profile.model} stopped the print transfer`,
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
          `The ${this.profile.model} reported print error ${response.errorCode}`,
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
      `The ${this.profile.model} did not report print completion`,
      true,
    );
  }

  async #finishCompletedTransfer(signal?: AbortSignal): Promise<void> {
    try {
      await this.transport.write(
        buildMakeIdControlFrame(MakeIdControlState.CancelOrReset),
        signal,
      );
      const response = await this.#readResponse(signal);
      if (
        response.kind !== "empty" &&
        response.kind !== "exited" &&
        (response.kind !== "success" || response.printing)
      ) {
        throw new MakeIdAdapterError(
          "makeid.protocol",
          `The ${this.profile.model} returned an invalid final response`,
          false,
        );
      }
    } catch (error) {
      // The printer already confirmed that all pages are complete. Do not
      // report a retryable print failure, because a retry can print duplicates.
      // Close this session so that a late or invalid final reply cannot be read
      // as the first reply of the next operation.
      this.context.log.warn(
        "The MakeID final reply was not usable. The session was closed.",
        { reason: adapterErrorReason(error) },
      );
      await this.invalidate();
    }
  }

  async #sendBestEffortReset(): Promise<void> {
    try {
      if (this.transport.open) {
        await this.transport.write(
          buildMakeIdControlFrame(MakeIdControlState.CancelOrReset),
        );
      }
    } catch {
      // The original cancellation error is more useful than a cleanup error.
    } finally {
      // A reset can produce a reply after cancellation. Close the transport so
      // that no later operation can consume that reply as its own response.
      await this.invalidate();
    }
  }
}

class MakeIdFf00Session extends MakeIdSession {
  async status(signal?: AbortSignal): Promise<PrinterStatus> {
    return this.runExclusive(async () => {
      this.assertOpen(signal);
      try {
        await this.transport.write(MAKEID_FF00_STATUS_QUERY, signal);
        await this.#readNonEmptyReply("status", signal);
        return {
          state: "ready",
          message: "Connection is responsive; detailed status is not available",
        };
      } catch (error) {
        await this.invalidate();
        throw normalizeAdapterError(error, signal);
      }
    });
  }

  async print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.runExclusive(async () => {
      this.assertOpen(signal);
      validateJob(job, this.printer, this.profile);
      try {
        // Captures from L1-300 firmware V1.07HH show that these five queries
        // are required before the session-open acknowledgement. They are kept
        // in TypeScript so later Windows and Android transports share the same
        // command ordering.
        for (const query of [
          MAKEID_FF00_MODEL_QUERY,
          MAKEID_FF00_FIRMWARE_QUERY,
          MAKEID_FF00_SERIAL_QUERY,
          MAKEID_FF00_STATUS_QUERY,
          MAKEID_FF00_BATTERY_QUERY,
        ]) {
          await this.transport.write(query, signal);
          await this.#readNonEmptyReply("handshake", signal);
        }
        await this.transport.write(MAKEID_FF00_SESSION_OPEN, signal);
        await this.transport.write(MAKEID_FF00_SESSION_MODE, signal);
        await this.#readUntil(Uint8Array.of(0x4f, 0x4b), signal);

        for (let pageIndex = 0; pageIndex < job.pages.length; pageIndex += 1) {
          const page = job.pages[pageIndex];
          if (!page) throw invalidJob(`page ${pageIndex + 1} is missing`);
          await this.#writeStream(
            buildMakeIdFf00RasterStream(page, this.profile),
            signal,
          );
        }

        await this.transport.write(MAKEID_FF00_SESSION_CLOSE, signal);
        await this.#readUntil(Uint8Array.of(0xaa), signal);
        // Captured L1 firmware emits the physical labels only after the final
        // close acknowledgement. Report completion after that proof.
        for (let pageIndex = 0; pageIndex < job.pages.length; pageIndex += 1) {
          this.reportProgress(onProgress, {
            completedPages: pageIndex + 1,
            totalPages: job.pages.length,
            message: `Printed label ${pageIndex + 1} of ${job.pages.length}`,
          });
        }
      } catch (error) {
        // No cancel command is known for this FF00 firmware. A failed transfer
        // can leave delayed bytes or an open device session. Close the dirty
        // stream so a later operation must start with a new connection.
        await this.invalidate();
        throw normalizeAdapterError(error, signal);
      }
    });
  }

  async #writeStream(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 100) {
      await this.transport.write(bytes.subarray(offset, offset + 100), signal);
      if (offset + 100 < bytes.length) await abortableDelay(15, signal);
    }
  }

  async #readReply(signal?: AbortSignal): Promise<Uint8Array> {
    return this.transport.read(
      signal
        ? { timeoutMs: this.options.responseTimeoutMs, signal }
        : { timeoutMs: this.options.responseTimeoutMs },
    );
  }

  async #readNonEmptyReply(
    label: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const reply = await this.#readReply(signal);
    if (reply.length === 0) {
      throw new MakeIdAdapterError(
        "makeid.protocol",
        `The ${this.profile.model} returned an empty ${label} reply`,
        true,
      );
    }
    return reply;
  }

  async #readUntil(expected: Uint8Array, signal?: AbortSignal): Promise<void> {
    let received = new Uint8Array();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const next = await this.#readReply(signal);
      const combined = new Uint8Array(received.length + next.length);
      combined.set(received);
      combined.set(next, received.length);
      received = combined.subarray(Math.max(0, combined.length - 4_096));
      if (includesBytes(received, expected)) return;
    }
    throw new MakeIdAdapterError(
      "makeid.protocol",
      `The ${this.profile.model} returned an unexpected reply`,
      true,
    );
  }
}

function includesBytes(bytes: Uint8Array, expected: Uint8Array): boolean {
  if (replyStartsWith(bytes, expected)) return true;
  outer: for (
    let start = 1;
    start + expected.length <= bytes.length;
    start += 1
  ) {
    for (let index = 0; index < expected.length; index += 1) {
      if (bytes[start + index] !== expected[index]) continue outer;
    }
    return true;
  }
  return false;
}

function adapterErrorReason(error: unknown): string {
  if (error instanceof MakeIdAdapterError) {
    return error.code;
  }
  if (error instanceof MakeIdTransportTimeoutError) {
    return "transport-timeout";
  }
  if (error instanceof Error) {
    return error.name;
  }
  return "unknown";
}

function readConnection(printer: PrinterDescriptor): MakeIdConnectionData {
  if (
    printer.adapterId !== MAKEID_ADAPTER_ID ||
    (printer.transport !== "bluetooth-low-energy" &&
      printer.transport !== "bluetooth-classic")
  ) {
    throw new MakeIdAdapterError(
      "makeid.invalid-printer",
      "The printer descriptor does not belong to the MakeID adapter",
      false,
    );
  }
  const transportDeviceId = printer.connection["transportDeviceId"];
  const profileId = printer.connection["profileId"];
  const legacyModel = printer.connection["model"];
  const advertisedName = printer.connection["advertisedName"];
  if (
    typeof transportDeviceId !== "string" ||
    transportDeviceId.trim().length === 0 ||
    (advertisedName !== undefined && typeof advertisedName !== "string")
  ) {
    throw new MakeIdAdapterError(
      "makeid.invalid-printer",
      "The MakeID connection data is invalid",
      false,
    );
  }

  // Version-1 desktop and iPad records stored only `model: "E1"`. Keep this
  // migration at the adapter boundary so future Android and Windows shells do
  // not need a second protocol-specific compatibility rule.
  const resolvedProfileId =
    profileId === undefined && legacyModel === "E1" ? "e1-abf0-203" : profileId;
  if (
    !makeIdProfileId(resolvedProfileId) &&
    resolvedProfileId !== "unresolved-l1" &&
    resolvedProfileId !== "unresolved-p31"
  ) {
    throw new MakeIdAdapterError(
      "makeid.invalid-printer",
      "The saved MakeID model profile is invalid",
      false,
    );
  }
  return typeof advertisedName === "string"
    ? { profileId: resolvedProfileId, transportDeviceId, advertisedName }
    : { profileId: resolvedProfileId, transportDeviceId };
}

function validateJob(
  job: PrintJob,
  printer: PrinterDescriptor,
  profile: MakeIdResolvedProfile,
): void {
  if (job.printerId !== printer.id) {
    throw invalidJob("The print job targets a different printer");
  }
  if (job.pages.length === 0) {
    throw invalidJob("A print job must contain at least one page");
  }
  if (
    !Number.isInteger(job.copies) ||
    job.copies < 1 ||
    job.copies > capabilitiesForProfile(profile).maxCopies
  ) {
    throw invalidJob(
      `copies must be from 1 to ${capabilitiesForProfile(profile).maxCopies}`,
    );
  }
  if (
    job.mediaId !== undefined &&
    !capabilitiesForProfile(profile).media.some(
      (media) => media.id === job.mediaId,
    )
  ) {
    throw invalidJob(`Unsupported ${profile.model} media: ${job.mediaId}`);
  }
  for (const page of job.pages) {
    validateRasterPage(page, profile);
  }
}

function validateRasterPage(
  page: RasterPage,
  profile: MakeIdResolvedProfile,
): void {
  const bytesPerLine = profile.rasterWidthPixels / 8;
  if (page.widthPixels !== profile.rasterWidthPixels) {
    throw invalidJob(
      `${profile.model} raster width must be ${profile.rasterWidthPixels} pixels`,
    );
  }
  if (!Number.isInteger(bytesPerLine) || page.bytesPerRow !== bytesPerLine) {
    throw invalidJob(`${profile.model} bytesPerRow must be ${bytesPerLine}`);
  }
  if (
    !Number.isInteger(page.heightPixels) ||
    page.heightPixels < 1 ||
    page.heightPixels > 0xffff
  ) {
    throw invalidJob(
      `${profile.model} raster height must be from 1 to 65535 pixels`,
    );
  }
  if (page.data.length !== page.bytesPerRow * page.heightPixels) {
    throw invalidJob(
      `${profile.model} raster data length does not match its dimensions`,
    );
  }
}

function swapAdjacentBytes(bytes: Uint8Array): void {
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const first = bytes[index] ?? 0;
    bytes[index] = bytes[index + 1] ?? 0;
    bytes[index + 1] = first;
  }
}

function readDarkness(job: PrintJob): number {
  const value = job.darkness ?? job.options?.["makeid.darkness"] ?? 20;
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

function resolveOptions(options: MakeIdAdapterOptions): ResolvedOptions {
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
      "The MakeID printer did not reply in time",
      true,
      { cause: error },
    );
  }
  if (
    error instanceof Error &&
    (error.name === "MakeIdProtocolError" ||
      error.name === "MakeIdFf00ProtocolError")
  ) {
    return new MakeIdAdapterError(
      "makeid.protocol",
      "The MakeID printer returned an invalid protocol response",
      false,
      { cause: error },
    );
  }
  return new MakeIdAdapterError(
    "makeid.transport",
    "The MakeID Bluetooth transport failed",
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
