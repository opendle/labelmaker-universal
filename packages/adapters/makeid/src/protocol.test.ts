import { describe, expect, it } from "vitest";

import {
  buildMakeIdControlFrame,
  buildMakeIdRasterFrame,
  calculateMakeIdChecksum,
  encodeLzo1xLiteralStream,
  MakeIdControlState,
  parseMakeIdAbf0Profile,
  parseMakeIdResponse,
} from "./protocol.js";

describe("MakeID protocol primitives", () => {
  it("builds a query frame whose byte sum is zero", () => {
    const frame = buildMakeIdControlFrame(MakeIdControlState.Query);

    expect([...frame]).toEqual([0x66, 0x06, 0x00, 0x10, 0x00, 0x84]);
    expect(sumBytes(frame)).toBe(0);
    expect(calculateMakeIdChecksum(frame.subarray(0, -1))).toBe(0x84);
  });

  it("encodes a new literal-only LZO1X vector", () => {
    const encoded = encodeLzo1xLiteralStream(
      Uint8Array.of(0xa5, 0x00, 0x5a, 0xc3),
    );

    expect([...encoded]).toEqual([
      0x15, 0xa5, 0x00, 0x5a, 0xc3, 0x11, 0x00, 0x00,
    ]);
  });

  it("uses the extended literal length above 238 bytes", () => {
    const input = Uint8Array.from({ length: 239 }, (_, index) => index & 0xff);
    const encoded = encodeLzo1xLiteralStream(input);

    expect([...encoded.subarray(0, 2)]).toEqual([0x00, 0xdd]);
    expect(encoded.subarray(2, 2 + input.length)).toEqual(input);
    expect([...encoded.subarray(-3)]).toEqual([0x11, 0x00, 0x00]);
  });

  it("places raster metadata and a valid checksum in a 0x66 frame", () => {
    const frame = buildMakeIdRasterFrame(Uint8Array.of(0x12, 0x34), {
      darkness: 20,
      mediaBits: 0x20,
      cutBits: 3,
      totalCopies: 2,
      currentCopy: 1,
      feedLengthPixels: 321,
      lineCount: 7,
      remainingFrames: 4,
    });

    expect(frame[0]).toBe(0x66);
    expect(frame[1]).toBe(frame.length);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(0x1b);
    expect(frame[4]).toBe(0x34);
    expect(frame[5]).toBe(3);
    expect([...frame.subarray(6, 10)]).toEqual([2, 0, 1, 0]);
    expect(frame[10]).toBe(1);
    expect([...frame.subarray(11, 17)]).toEqual([0x41, 0x01, 7, 0, 4, 0]);
    expect([...frame.subarray(17, 19)]).toEqual([0x12, 0x34]);
    expect(sumBytes(frame)).toBe(0);
  });

  it("parses busy, retry, and printer-error responses", () => {
    expect(parseMakeIdResponse(response({ printing: true }))).toMatchObject({
      kind: "success",
      printing: true,
    });
    expect(parseMakeIdResponse(response({ flags: 0x40 }))).toMatchObject({
      kind: "resend",
      printing: false,
    });
    expect(parseMakeIdResponse(response({ flags: 0x05 }))).toMatchObject({
      kind: "error",
      errorCode: 5,
    });
  });

  it("rejects a response whose declared length does not match its bytes", () => {
    const bytes = response({});
    bytes[1] = 35;

    expect(() => parseMakeIdResponse(bytes)).toThrow(/length field/);
  });

  it("detects the old 203- and 300-DPI L1 profiles from status bytes", () => {
    const dpi203 = response({});
    dpi203[6] = 0;
    const dpi300 = response({});
    dpi300[6] = 1;

    expect(parseMakeIdAbf0Profile(dpi203, "l1", "L1C25E01553")).toMatchObject({
      profileId: "l1-abf0-203",
      model: "MakeID L1 203 DPI",
      dpi: 203,
      rasterWidthPixels: 96,
      maxRowsPerPacket: 85,
      swapRasterBytePairs: true,
    });
    expect(parseMakeIdAbf0Profile(dpi300, "l1", "MakeID L1")).toMatchObject({
      profileId: "l1-abf0-300",
      model: "MakeID L1 300 DPI",
      dpi: 300,
      rasterWidthPixels: 144,
      maxRowsPerPacket: 56,
      swapRasterBytePairs: true,
    });
  });

  it("uses protocol 1.3 head width, row limit, and byte order", () => {
    const bytes = new Uint8Array(44);
    bytes[0] = 0x66;
    bytes[1] = bytes.length;
    bytes[3] = 0x10;
    bytes[6] = 1;
    bytes[36] = 1;
    bytes[37] = 3;
    bytes[38] = 0x04;
    bytes[39] = 38;
    bytes[41] = 64;

    expect(parseMakeIdAbf0Profile(bytes, "p31", "P31S-Office")).toEqual({
      profileId: "p31-abf0-300",
      model: "P31S-Office",
      protocolFamily: "abf0-66",
      dpi: 300,
      rasterWidthPixels: 304,
      printableWidthMm: 25.7,
      maxRowsPerPacket: 64,
      swapRasterBytePairs: true,
      protocolVersion: "1.3",
    });
  });

  it("uses a clear protocol 1.3 byte-order flag without swapping", () => {
    const bytes = new Uint8Array(44);
    bytes[0] = 0x66;
    bytes[1] = bytes.length;
    bytes[3] = 0x10;
    bytes[6] = 1;
    bytes[36] = 1;
    bytes[37] = 3;
    bytes[39] = 18;
    bytes[41] = 56;

    expect(parseMakeIdAbf0Profile(bytes, "l1")).toMatchObject({
      profileId: "l1-abf0-300",
      rasterWidthPixels: 144,
      swapRasterBytePairs: false,
    });
  });

  it("rejects status model evidence from a different family", () => {
    const bytes = response({});
    bytes[6] = 4;
    bytes.set(new TextEncoder().encode("L1-30"), 10);

    expect(() => parseMakeIdAbf0Profile(bytes, "p31", "P31S")).toThrow(
      /does not match/,
    );
  });

  it("rejects a 300-DPI P31-family reply without an explicit row width", () => {
    const bytes = response({});
    bytes[6] = 1;

    expect(() => parseMakeIdAbf0Profile(bytes, "p31", "P31S")).toThrow(
      /does not report its raster width/,
    );
  });

  it("rejects different horizontal and vertical DPI values", () => {
    const bytes = response({});
    bytes[6] = 1;
    bytes[15] = 1;

    expect(() => parseMakeIdAbf0Profile(bytes, "l1")).toThrow(
      /different horizontal and vertical DPI/,
    );
  });

  it("rejects an unknown DPI code instead of selecting a model fallback", () => {
    const bytes = response({});
    bytes[6] = 7;

    expect(() => parseMakeIdAbf0Profile(bytes, "p31", "P31S")).toThrow(
      /unsupported DPI code/,
    );
  });

  it("rejects unsupported protocol 1.3 head widths and unsafe row limits", () => {
    const unsupportedWidth = new Uint8Array(44);
    unsupportedWidth[0] = 0x66;
    unsupportedWidth[1] = unsupportedWidth.length;
    unsupportedWidth[3] = 0x10;
    unsupportedWidth[6] = 1;
    unsupportedWidth[36] = 1;
    unsupportedWidth[37] = 3;
    unsupportedWidth[39] = 17;
    unsupportedWidth[41] = 56;
    expect(() => parseMakeIdAbf0Profile(unsupportedWidth, "l1")).toThrow(
      /unsupported raster width/,
    );

    const unsafeRows = unsupportedWidth.slice();
    unsafeRows[39] = 18;
    unsafeRows[41] = 0xff;
    unsafeRows[42] = 0xff;
    expect(() => parseMakeIdAbf0Profile(unsafeRows, "l1")).toThrow(
      /invalid raster row limit/,
    );
  });

  it("removes the optional BLE notification wrapper before parsing", () => {
    const wrapped = new Uint8Array(40);
    wrapped.set([0x23, 0x23, 1, 0, 0x66, 36, 0, 0x10]);

    expect(parseMakeIdResponse(wrapped)).toMatchObject({ kind: "success" });
  });
});

function response(options: { flags?: number; printing?: boolean }): Uint8Array {
  const bytes = new Uint8Array(36);
  bytes[0] = 0x66;
  bytes[1] = 36;
  bytes[3] = 0x10;
  bytes[4] = options.flags ?? 0;
  bytes[35] = options.printing ? 0x80 : 0;
  return bytes;
}

function sumBytes(bytes: Uint8Array): number {
  return bytes.reduce((sum, byte) => (sum + byte) & 0xff, 0);
}
