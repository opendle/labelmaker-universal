import type { RasterAlignment } from "@labelmaker/printing";

const POINTS_PER_INCH = 72;
const MILLIMETERS_PER_INCH = 25.4;

export function pointsToMillimeters(points: number): number {
  return (points * MILLIMETERS_PER_INCH) / POINTS_PER_INCH;
}

export function containerFontSize(
  fontSizePt: number,
  plateWidthMm: number,
): string {
  const ratio = pointsToMillimeters(fontSizePt) / plateWidthMm;
  return `calc(${ratio} * 100cqi)`;
}

export function printableMarginPercent(
  marginMm: number,
  plateHeightMm: number,
): number {
  return Math.min(100, Math.max(0, (marginMm / plateHeightMm) * 100));
}

export interface PrintableMargins {
  readonly topMm: number;
  readonly bottomMm: number;
}

export function nonPrintableMarginsMm(
  plateHeightMm: number,
  printHeadSizeMm: number | undefined,
  configuredTopMm = 0,
  configuredBottomMm = 0,
  rasterAlignment: RasterAlignment = "center",
): PrintableMargins {
  if (printHeadSizeMm === undefined) return { topMm: 0, bottomMm: 0 };
  if (plateHeightMm <= printHeadSizeMm) return { topMm: 0, bottomMm: 0 };
  const unusedHeadWidthMm = plateHeightMm - printHeadSizeMm;
  const alignedBaseMm =
    rasterAlignment === "start"
      ? 0
      : rasterAlignment === "end"
        ? unusedHeadWidthMm
        : unusedHeadWidthMm / 2;
  const marginAdjustmentMm = (configuredTopMm - configuredBottomMm) / 2;
  const printableTopMm = alignedBaseMm + marginAdjustmentMm;
  return {
    topMm: Math.max(0, printableTopMm),
    bottomMm: Math.max(0, plateHeightMm - printableTopMm - printHeadSizeMm),
  };
}

export function displayMillimeters(value: number): number {
  return Math.round(value * 10) / 10;
}
