import type { RasterPage } from "@labelmaker/printing";

import type { MakeIdResolvedProfile } from "./models.js";

export const MAKEID_FF00_MODEL_QUERY = Uint8Array.of(0x10, 0xff, 0x20, 0xf0);
export const MAKEID_FF00_FIRMWARE_QUERY = Uint8Array.of(0x10, 0xff, 0x20, 0xf1);
export const MAKEID_FF00_SERIAL_QUERY = Uint8Array.of(0x10, 0xff, 0x20, 0xf2);
export const MAKEID_FF00_STATUS_QUERY = Uint8Array.of(0x10, 0xff, 0x40);
export const MAKEID_FF00_BATTERY_QUERY = Uint8Array.of(0x10, 0xff, 0x50, 0xf1);
export const MAKEID_FF00_SESSION_OPEN = Uint8Array.of(0x10, 0xff, 0xfe, 0x01);
export const MAKEID_FF00_SESSION_MODE = Uint8Array.of(
  0x10,
  0xff,
  0x10,
  0x00,
  0x02,
);
export const MAKEID_FF00_SESSION_CLOSE = Uint8Array.of(0x10, 0xff, 0xfe, 0x45);

export class MakeIdFf00ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MakeIdFf00ProtocolError";
  }
}

/**
 * Parse the model reply used by FF00 L1 firmware.
 *
 * Public captures show `L1-300` on firmware V1.07HH. An older Classic report
 * uses the same command family with a 96-pixel L1. Keep both profiles so a
 * future Android or Windows serial transport can reuse the protocol driver.
 */
export function parseMakeIdFf00Model(bytes: Uint8Array): MakeIdResolvedProfile {
  const text = new TextDecoder("ascii").decode(bytes).replaceAll("\0", "");
  const match = /L1[^0-9]*(203|300)/i.exec(text);
  if (!match) {
    throw new MakeIdFf00ProtocolError(
      "The FF00 printer did not identify a supported L1 resolution",
    );
  }
  const dpi = Number(match[1]);
  const rasterWidthPixels = dpi === 300 ? 144 : 96;
  return {
    profileId: dpi === 300 ? "l1-ff00-300" : "l1-ff00-203",
    model: `MakeID L1 ${dpi} DPI`,
    protocolFamily: "ff00-escpos",
    dpi,
    rasterWidthPixels,
    printableWidthMm: Math.round(((rasterWidthPixels * 25.4) / dpi) * 10) / 10,
    rasterAlignment: "center",
    maxRowsPerPacket: 0xffff,
    swapRasterBytePairs: false,
  };
}

/** Build one ESC/POS `GS v 0` raster stream after strict dimension checks. */
export function buildMakeIdFf00RasterStream(
  page: RasterPage,
  profile: MakeIdResolvedProfile,
): Uint8Array {
  const bytesPerRow = profile.rasterWidthPixels / 8;
  if (
    !Number.isInteger(bytesPerRow) ||
    page.widthPixels !== profile.rasterWidthPixels ||
    page.bytesPerRow !== bytesPerRow ||
    page.data.length !== page.heightPixels * bytesPerRow
  ) {
    throw new MakeIdFf00ProtocolError(
      `MakeID ${profile.model} raster data does not match its ${profile.rasterWidthPixels}-pixel head`,
    );
  }
  if (
    !Number.isInteger(page.heightPixels) ||
    page.heightPixels < 1 ||
    page.heightPixels > 0xffff
  ) {
    throw new MakeIdFf00ProtocolError(
      "A MakeID FF00 raster must contain from 1 to 65535 rows",
    );
  }
  // The public L1-300 capture sends this lead-in for each image, after the
  // session-level open/mode/OK exchange. It is not a second session handshake.
  const stream = new Uint8Array(12 + page.data.length);
  stream.set(MAKEID_FF00_SESSION_OPEN, 0);
  stream.set(
    [
      0x1d,
      0x76,
      0x30,
      0x00,
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      page.heightPixels & 0xff,
      (page.heightPixels >> 8) & 0xff,
    ],
    4,
  );
  stream.set(page.data, 12);
  return stream;
}

export function replyStartsWith(
  bytes: Uint8Array,
  expected: Uint8Array,
): boolean {
  return (
    bytes.length >= expected.length &&
    expected.every((value, index) => bytes[index] === value)
  );
}
