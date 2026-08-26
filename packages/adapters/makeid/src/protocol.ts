/**
 * Hardware-independent MakeID protocol primitives.
 *
 * These fields are based on public reverse-engineering reports. MakeID does not
 * publish an E1 protocol specification. Keep changes behind fixed tests and
 * verify them with a captured job before treating them as hardware-safe.
 */

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

function appendChecksum(bytes: Uint8Array): Uint8Array {
  const output = new Uint8Array(bytes.length + 1);
  output.set(bytes);
  output[output.length - 1] = calculateMakeIdChecksum(bytes);
  return output;
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
