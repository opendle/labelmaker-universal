import { describe, expect, it } from "vitest";

import {
  buildMakeIdFf00RasterStream,
  parseMakeIdFf00Model,
  replyStartsWith,
} from "./ff00-protocol.js";

describe("MakeID FF00 protocol", () => {
  it.each([
    ["L1-300", 300, 144, "l1-ff00-300"],
    ["model:L1 203", 203, 96, "l1-ff00-203"],
  ] as const)("identifies %s", (reply, dpi, width, profileId) => {
    expect(parseMakeIdFf00Model(new TextEncoder().encode(reply))).toMatchObject(
      {
        dpi,
        rasterWidthPixels: width,
        profileId,
        protocolFamily: "ff00-escpos",
      },
    );
  });

  it("rejects an FF00 reply which does not prove the L1 resolution", () => {
    expect(() => parseMakeIdFf00Model(new TextEncoder().encode("L1"))).toThrow(
      /resolution/,
    );
  });

  it("builds an independently generated 144-pixel ESC/POS raster vector", () => {
    const profile = parseMakeIdFf00Model(new TextEncoder().encode("L1-300"));
    const data = Uint8Array.from({ length: 36 }, (_, index) => index);
    const stream = buildMakeIdFf00RasterStream(
      {
        widthPixels: 144,
        heightPixels: 2,
        bytesPerRow: 18,
        data,
      },
      profile,
    );

    expect([...stream.subarray(0, 12)]).toEqual([
      0x10, 0xff, 0xfe, 0x01, 0x1d, 0x76, 0x30, 0x00, 18, 0, 2, 0,
    ]);
    expect(stream.subarray(12)).toEqual(data);
    expect(
      replyStartsWith(Uint8Array.of(0x4f, 0x4b, 0), Uint8Array.of(0x4f, 0x4b)),
    ).toBe(true);
  });
});
