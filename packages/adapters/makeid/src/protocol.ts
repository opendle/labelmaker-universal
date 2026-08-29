/**
 * Hardware-independent MakeID protocol primitives.
 *
 * These fields are based on public reverse-engineering reports. MakeID does not
 * publish an E1 protocol specification. Keep changes behind fixed tests and
 * verify them with a captured job before treating them as hardware-safe.
 */

import type {
  MakeIdDiscoveryKind,
  MakeIdProfileId,
  MakeIdResolvedProfile,
} from "./models.js";
import { classifyMakeIdName } from "./models.js";

export const MAKEID_FRAME_MARKER = 0x66;
export const MAKEID_PRINT_HEAD_PIXELS = 96;
export const MAKEID_BYTES_PER_LINE = MAKEID_PRINT_HEAD_PIXELS / 8;

export const enum MakeIdCommand {
  Control = 0x10,
  RasterData = 0x1b,
  EmptyResponse = 0x11,
}

export const enum MakeIdControlState {
  Query = 0x00,
  Pause = 0x01,
  Resume = 0x02,
  CancelOrReset = 0x03,
}

export type MakeIdResponseKind =
  | "success"
  | "wait"
  | "resend"
  | "error"
  | "empty"
  | "paused"
  | "exited";

export interface MakeIdResponse {
  readonly kind: MakeIdResponseKind;
  readonly errorCode: number;
  readonly printing: boolean;
}

const DPI_BY_DEVICE_CODE = [203, 300, 600, 180, 288] as const;
const VERTICAL_DPI_BY_DEVICE_CODE = [
  undefined,
  203,
  300,
  600,
  180,
  288,
] as const;

export interface MakeIdRasterFrameOptions {
  readonly darkness: number;
  readonly mediaBits: number;
  readonly cutBits: number;
  readonly totalCopies: number;
  readonly currentCopy: number;
  /** The label length along the feed direction, in printer pixels. */
  readonly feedLengthPixels: number;
  readonly lineCount: number;
  readonly remainingFrames: number;
}

export class MakeIdProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MakeIdProtocolError";
  }
}

/** Return the byte which makes the unsigned sum of all frame bytes equal zero. */
export function calculateMakeIdChecksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) {
    sum = (sum + byte) & 0xff;
  }
  return -sum & 0xff;
}

export function buildMakeIdControlFrame(state: MakeIdControlState): Uint8Array {
  const withoutChecksum = Uint8Array.of(
    MAKEID_FRAME_MARKER,
    0x06,
    0x00,
    MakeIdCommand.Control,
    state,
  );
  return appendChecksum(withoutChecksum);
}

/**
 * Encode one LZO1X stream which contains literal bytes only.
 *
 * This avoids match references, which have not yet been checked on a real E1.
 * It is valid LZO1X framing, but it is intentionally not a compressor.
 */
export function encodeLzo1xLiteralStream(input: Uint8Array): Uint8Array {
  if (input.length < 4) {
    throw new MakeIdProtocolError(
      "An LZO first-literal run must contain at least four bytes",
    );
  }

  const prefix: number[] = [];
  if (input.length <= 238) {
    prefix.push(input.length + 17);
  } else {
    prefix.push(0x00);
    let extension = input.length - 18;
    while (extension > 255) {
      prefix.push(0x00);
      extension -= 255;
    }
    prefix.push(extension);
  }

  const output = new Uint8Array(prefix.length + input.length + 3);
  output.set(prefix, 0);
  output.set(input, prefix.length);
  output.set([0x11, 0x00, 0x00], prefix.length + input.length);
  return output;
}

export function buildMakeIdRasterFrame(
  payload: Uint8Array,
  options: MakeIdRasterFrameOptions,
): Uint8Array {
  if (payload.length === 0) {
    throw new MakeIdProtocolError("A raster frame payload cannot be empty");
  }
  assertUnsigned(options.darkness, 5, "darkness");
  assertUnsigned(options.mediaBits, 8, "mediaBits");
  assertUnsigned(options.cutBits, 5, "cutBits");
  assertUnsigned(options.totalCopies, 16, "totalCopies");
  assertUnsigned(options.currentCopy, 16, "currentCopy");
  assertUnsigned(options.feedLengthPixels, 16, "feedLengthPixels");
  assertUnsigned(options.lineCount, 16, "lineCount");
  assertUnsigned(options.remainingFrames, 8, "remainingFrames");

  const frameLength = 18 + payload.length;
  if (frameLength > 0xffff) {
    throw new MakeIdProtocolError(
      "A raster frame exceeds the 16-bit length field",
    );
  }

  const frame = new Uint8Array(frameLength);
  frame[0] = MAKEID_FRAME_MARKER;
  writeUint16LittleEndian(frame, 1, frameLength);
  frame[3] = MakeIdCommand.RasterData;

  // Field meanings below are not vendor documentation. The bit positions are
  // stable in current public captures but need E1 hardware verification.
  frame[4] = (options.darkness & 0x1f) | options.mediaBits;
  frame[5] = options.cutBits;
  writeUint16LittleEndian(frame, 6, options.totalCopies);
  writeUint16LittleEndian(frame, 8, options.currentCopy);
  frame[10] = 0x01; // Observed marker for an LZO-encoded raster payload.
  writeUint16LittleEndian(frame, 11, options.feedLengthPixels);
  writeUint16LittleEndian(frame, 13, options.lineCount);
  frame[15] = options.remainingFrames;
  frame[16] = 0x00;
  frame.set(payload, 17);
  frame[frame.length - 1] = calculateMakeIdChecksum(
    frame.subarray(0, frame.length - 1),
  );
  return frame;
}

/** Parse the status fields which current E1 reports expose in 36-byte replies. */
export function parseMakeIdResponse(bytes: Uint8Array): MakeIdResponse {
  bytes = stripMakeIdNotificationWrapper(bytes);
  if (bytes[0] !== MAKEID_FRAME_MARKER) {
    throw new MakeIdProtocolError("A MakeID response has an invalid marker");
  }
  if (bytes.length < 3) {
    throw new MakeIdProtocolError("A MakeID response has no length field");
  }
  const declaredLength = (bytes[1] ?? 0) | ((bytes[2] ?? 0) << 8);
  if (declaredLength !== bytes.length) {
    throw new MakeIdProtocolError(
      `A MakeID response length field is ${declaredLength}; received ${bytes.length} bytes`,
    );
  }
  if (bytes.length >= 6 && bytes[3] === MakeIdCommand.EmptyResponse) {
    return { kind: "empty", errorCode: 0, printing: false };
  }
  if (bytes.length < 36) {
    throw new MakeIdProtocolError(
      `A MakeID response must contain at least 36 bytes; received ${bytes.length}`,
    );
  }

  const flags = bytes[4] ?? 0;
  const finalState = bytes[35] ?? 0;
  const errorCode = flags & 0x3f;
  const hasError = errorCode !== 0 && errorCode !== 23;
  const state = (finalState >> 5) & 0x03;

  let kind: MakeIdResponseKind;
  if (hasError) {
    kind = "error";
  } else if ((flags & 0x80) !== 0) {
    kind = "wait";
  } else if ((flags & 0x40) !== 0) {
    kind = "resend";
  } else if (state === 1) {
    kind = "paused";
  } else if (state === 3) {
    kind = "exited";
  } else {
    kind = "success";
  }

  return { kind, errorCode, printing: (finalState & 0x80) !== 0 };
}

/**
 * Read model capabilities from the safe 0x10 status response.
 *
 * The official MakeID Android application uses these response fields for L1,
 * P31, Q31, and GP31 printers. This probe is important for every future host:
 * L1 advertisements do not distinguish the 203- and 300-DPI models. Protocol
 * 1.3 added the explicit head width, row-block limit, and byte-order flag.
 */
export function parseMakeIdAbf0Profile(
  bytes: Uint8Array,
  kind: MakeIdDiscoveryKind,
  advertisedName?: string,
): MakeIdResolvedProfile {
  bytes = stripMakeIdNotificationWrapper(bytes);
  parseMakeIdResponse(bytes);
  if (bytes[3] !== MakeIdCommand.Control) {
    throw new MakeIdProtocolError(
      "A MakeID capability response has an invalid command",
    );
  }

  const horizontalDpi = DPI_BY_DEVICE_CODE[(bytes[6] ?? 0) & 0x07];
  const verticalDpi = VERTICAL_DPI_BY_DEVICE_CODE[(bytes[15] ?? 0) & 0x0f];
  if (
    horizontalDpi !== undefined &&
    verticalDpi !== undefined &&
    horizontalDpi !== verticalDpi
  ) {
    throw new MakeIdProtocolError(
      `The MakeID ${kind.toUpperCase()} reported different horizontal and vertical DPI values`,
    );
  }
  const dpi = verticalDpi ?? horizontalDpi;
  if (dpi === undefined) {
    throw new MakeIdProtocolError(
      `The MakeID ${kind.toUpperCase()} reported an unsupported DPI code`,
    );
  }
  if (
    (kind === "e1" && dpi !== 203) ||
    (kind === "l1" && dpi !== 203 && dpi !== 300) ||
    (kind === "p31" && dpi !== 288 && dpi !== 300)
  ) {
    throw new MakeIdProtocolError(
      `The MakeID ${kind.toUpperCase()} reported unsupported ${dpi} DPI`,
    );
  }
  const reportedModel = new TextDecoder("ascii")
    .decode(bytes.subarray(10, Math.min(15, bytes.length)))
    .replaceAll("\0", "")
    .trim();
  const reportedKind = classifyReportedModel(reportedModel);
  if (reportedModel.length > 0 && reportedKind === undefined) {
    throw new MakeIdProtocolError(
      `The MakeID status reported unsupported model ${reportedModel}`,
    );
  }
  if (reportedKind !== undefined && reportedKind !== kind) {
    throw new MakeIdProtocolError(
      `The MakeID status model ${reportedModel} does not match the ${kind.toUpperCase()} advertisement`,
    );
  }
  const profileId: MakeIdProfileId =
    kind === "e1"
      ? "e1-abf0-203"
      : kind === "l1"
        ? dpi === 300
          ? "l1-abf0-300"
          : "l1-abf0-203"
        : dpi === 300
          ? "p31-abf0-300"
          : "p31-abf0-288";

  const protocolMajor = bytes.length >= 43 ? (bytes[36] ?? 0) : 0;
  const protocolMinor = bytes.length >= 43 ? (bytes[37] ?? 0) : 0;
  const hasExtendedCapabilities =
    protocolMajor > 1 || (protocolMajor === 1 && protocolMinor >= 3);
  // Label Pro 1.8.2 calls bytes 39-40 the number of raster bytes in one
  // head line. Convert it to the transport-neutral pixel width here.
  const reportedBytesPerRow = hasExtendedCapabilities
    ? readUint16LittleEndian(bytes, 39)
    : 0;
  const reportedRows = hasExtendedCapabilities
    ? readUint16LittleEndian(bytes, 41)
    : 0;
  if (kind === "p31" && dpi === 300 && reportedBytesPerRow === 0) {
    throw new MakeIdProtocolError(
      "A 300-DPI MakeID P31-family response does not report its raster width",
    );
  }
  const oldWidth =
    kind === "p31" ? 288 : kind === "l1" && dpi === 300 ? 144 : 96;
  const rasterWidthPixels =
    reportedBytesPerRow > 0 ? reportedBytesPerRow * 8 : oldWidth;
  const supportedBytesPerRow =
    kind === "e1"
      ? 12
      : kind === "l1"
        ? dpi === 300
          ? 18
          : 12
        : dpi === 300
          ? 38
          : 36;
  if (rasterWidthPixels !== supportedBytesPerRow * 8) {
    throw new MakeIdProtocolError(
      `The MakeID ${kind.toUpperCase()} reported unsupported raster width ${rasterWidthPixels}`,
    );
  }
  const oldRows =
    kind === "e1"
      ? 170
      : kind === "l1"
        ? dpi === 300
          ? 56
          : 85
        : Math.floor(2048 / Math.ceil(rasterWidthPixels / 8));
  const maxRowsPerPacket = reportedRows > 0 ? reportedRows : oldRows;
  const rasterBytesPerPacket = supportedBytesPerRow * maxRowsPerPacket;
  if (
    maxRowsPerPacket < 1 ||
    makeIdLiteralStreamLength(rasterBytesPerPacket) + 18 > 0xffff
  ) {
    throw new MakeIdProtocolError(
      `The MakeID ${kind.toUpperCase()} reported an invalid raster row limit`,
    );
  }
  const normalizedName = advertisedName?.trim();
  const model =
    kind === "e1"
      ? "MakeID E1"
      : kind === "l1"
        ? `MakeID L1 ${dpi} DPI`
        : normalizedName &&
            /^(?:MAKEID\s+)?(?:P31|Q31|GP31)/i.test(normalizedName)
          ? normalizedName
          : "MakeID P31 family";

  return {
    profileId,
    model,
    protocolFamily: "abf0-66",
    dpi,
    rasterWidthPixels,
    printableWidthMm: roundTenth((rasterWidthPixels * 25.4) / dpi),
    maxRowsPerPacket,
    // The official application swaps each byte pair for old L1/P31 paths.
    // Protocol 1.3 reports the required order in bit 2 instead. E1 hardware
    // uses canonical order and is kept separate from that application rule.
    swapRasterBytePairs:
      kind === "e1"
        ? false
        : hasExtendedCapabilities
          ? ((bytes[38] ?? 0) & 0x04) !== 0
          : true,
    ...(hasExtendedCapabilities
      ? { protocolVersion: `${protocolMajor}.${protocolMinor}` }
      : {}),
  };
}

/** Remove the optional four-byte `23 23 xx xx` BLE notification envelope. */
export function stripMakeIdNotificationWrapper(bytes: Uint8Array): Uint8Array {
  return bytes.length >= 4 && bytes[0] === 0x23 && bytes[1] === 0x23
    ? bytes.subarray(4)
    : bytes;
}

function appendChecksum(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length + 1);
  output.set(bytes);
  output[output.length - 1] = calculateMakeIdChecksum(bytes);
  return output;
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function classifyReportedModel(model: string): MakeIdDiscoveryKind | undefined {
  if (/^E1/i.test(model)) return "e1";
  if (/^L1(?:\b|[-_])/i.test(model)) return "l1";
  if (/^(?:P31|Q31|GP31)(?:\b|[-_])/i.test(model)) return "p31";
  return classifyMakeIdName(model);
}

function makeIdLiteralStreamLength(inputLength: number): number {
  if (inputLength <= 238) return inputLength + 4;
  const extension = inputLength - 18;
  const extensionBytes = Math.floor((extension - 1) / 255) + 1;
  return inputLength + extensionBytes + 4;
}

function assertUnsigned(value: number, bitCount: number, field: string): void {
  const maximum = 2 ** bitCount - 1;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new MakeIdProtocolError(
      `${field} must be an integer from 0 to ${maximum}`,
    );
  }
}

function writeUint16LittleEndian(
  target: Uint8Array,
  offset: number,
  value: number,
): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}
