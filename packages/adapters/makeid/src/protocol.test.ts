import { describe, expect, it } from "vitest";

import {
  buildMakeIdControlFrame,
  buildMakeIdRasterFrame,
  calculateMakeIdChecksum,
  encodeLzo1xLiteralStream,
  MakeIdControlState,
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
