import type {
  OfflinePrinterCapabilities,
  PrinterCapabilities,
  RasterAlignment,
} from "@labelmaker/printing";

export type MakeIdProtocolFamily = "abf0-66" | "ff00-escpos";

export type MakeIdProfileId =
  | "e1-abf0-203"
  | "l1-abf0-203"
  | "l1-abf0-300"
  | "l1-ff00-203"
  | "l1-ff00-300"
  | "p31-abf0-288"
  | "p31-abf0-300";

export type MakeIdDiscoveryKind = "e1" | "l1" | "p31";

export interface MakeIdResolvedProfile {
  readonly profileId: MakeIdProfileId;
  readonly model: string;
  readonly protocolFamily: MakeIdProtocolFamily;
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly printableWidthMm: number;
  readonly rasterAlignment: RasterAlignment;
  readonly maxRowsPerPacket: number;
  readonly swapRasterBytePairs: boolean;
  readonly protocolVersion?: string;
}

const DARKNESS = {
  minimum: 0,
  maximum: 31,
  step: 1,
  defaultValue: 20,
} as const;

/**
 * Return a conservative MakeID name family. A name never selects L1 DPI.
 *
 * The official Android application selects its L1 driver from the `L1`
 * prefix, but learns 203/300 DPI from the printer status response. P31, Q31,
 * and GP31 names share the P31 protocol path. Keep the same distinction in
 * future Android and Windows transports; do not add a user DPI override.
 */
export function classifyMakeIdName(
  name: string | undefined,
): MakeIdDiscoveryKind | undefined {
  if (!name) return undefined;
  const normalized = name.trim().toUpperCase();
  if (
    normalized.startsWith("YICHIPFPGA-") ||
    normalized === "MAKEID E1" ||
    normalized.startsWith("MAKEID E1-") ||
    /^E1\d{2}[A-Z]\d{5}$/.test(normalized)
  ) {
    return "e1";
  }
  const withoutManufacturer = normalized.replace(/^MAKEID\s+/, "");
  if (withoutManufacturer.startsWith("L1")) return "l1";
  if (/^(?:P31|Q31|GP31)/.test(withoutManufacturer)) return "p31";
  return undefined;
}

export function candidateProtocolFamilies(
  kind: MakeIdDiscoveryKind,
): readonly MakeIdProtocolFamily[] {
  // Some L1-300 firmware exposes FF00 and an ESC/POS stream. Current MakeID
  // Android code uses ABF0 and 0x66 for L1. Probe both and accept only a
  // parseable model/status reply. E1 and P31 evidence supports ABF0 only.
  return kind === "l1" ? ["abf0-66", "ff00-escpos"] : ["abf0-66"];
}

export function offlineCapabilitiesForProfile(
  profile: MakeIdResolvedProfile,
): OfflinePrinterCapabilities {
  const halfUnprintableMarginMm =
    profile.profileId === "e1-abf0-203" || profile.profileId.startsWith("l1-")
      ? Math.max(0, (16 - profile.printableWidthMm) / 2)
      : 0;
  return {
    dpi: profile.dpi,
    rasterWidthPixels: profile.rasterWidthPixels,
    printableWidthMm: profile.printableWidthMm,
    rasterAlignment: profile.rasterAlignment,
    printHeadMarginTopMm: halfUnprintableMarginMm,
    printHeadMarginBottomMm: halfUnprintableMarginMm,
    ...(profile.protocolFamily === "abf0-66" ? { darkness: DARKNESS } : {}),
  };
}

export function capabilitiesForProfile(
  profile: MakeIdResolvedProfile,
): PrinterCapabilities {
  const offline = offlineCapabilitiesForProfile(profile);
  return {
    ...offline,
    colorModes: ["monochrome"],
    media: profile.profileId.startsWith("p31-")
      ? [
          {
            id: "makeid-p31-25_4mm-continuous",
            displayName: "25.4 mm continuous tape",
            widthMm: 25.4,
            continuous: true,
          },
        ]
      : [9, 12, 16].map((widthMm) => ({
          id: `makeid-${profile.profileId.split("-")[0]}-${widthMm}mm-continuous`,
          displayName: `${widthMm} mm continuous tape`,
          widthMm,
          continuous: true,
        })),
    maxCopies: profile.protocolFamily === "abf0-66" ? 9 : 1,
    supportsCut: false,
    // The public FF00 capture proves that a status query gets a reply, but it
    // does not decode ready, media, cover, or error fields.
    supportsStatus: profile.protocolFamily === "abf0-66",
  };
}

/** Values confirmed on physical E1 hardware and used for old saved records. */
export const MAKEID_E1_PROFILE: MakeIdResolvedProfile = {
  profileId: "e1-abf0-203",
  model: "MakeID E1",
  protocolFamily: "abf0-66",
  dpi: 203,
  rasterWidthPixels: 96,
  printableWidthMm: 12,
  rasterAlignment: "start",
  maxRowsPerPacket: 170,
  swapRasterBytePairs: false,
};

export function makeIdProfileId(value: unknown): value is MakeIdProfileId {
  return (
    value === "e1-abf0-203" ||
    value === "l1-abf0-203" ||
    value === "l1-abf0-300" ||
    value === "l1-ff00-203" ||
    value === "l1-ff00-300" ||
    value === "p31-abf0-288" ||
    value === "p31-abf0-300"
  );
}

export function makeIdProtocolFamily(
  value: unknown,
): value is MakeIdProtocolFamily {
  return value === "abf0-66" || value === "ff00-escpos";
}

export function defaultProfileForId(
  profileId: MakeIdProfileId,
): MakeIdResolvedProfile {
  if (profileId === "e1-abf0-203") return MAKEID_E1_PROFILE;
  const dpi = profileId.endsWith("-300")
    ? 300
    : profileId.endsWith("-288")
      ? 288
      : 203;
  const p31 = profileId.startsWith("p31-");
  const ff00 = profileId.includes("-ff00-");
  // A 300-DPI P31-family response needs the protocol-1.3 row-width field.
  // Current evidence reports 38 bytes (304 transport pixels), which includes
  // the byte-alignment padding around the nominal 300-dot marketing width.
  const rasterWidthPixels = p31
    ? dpi === 300
      ? 304
      : 288
    : dpi === 300
      ? 144
      : 96;
  return {
    profileId,
    model: p31 ? "MakeID P31 family" : `MakeID L1 ${dpi} DPI`,
    protocolFamily: ff00 ? "ff00-escpos" : "abf0-66",
    dpi,
    rasterWidthPixels,
    printableWidthMm: Math.round(((rasterWidthPixels * 25.4) / dpi) * 10) / 10,
    rasterAlignment: "center",
    maxRowsPerPacket: ff00
      ? 0xffff
      : dpi === 300
        ? 56
        : p31
          ? Math.floor(2048 / Math.ceil(rasterWidthPixels / 8))
          : 85,
    swapRasterBytePairs: !ff00,
  };
}
