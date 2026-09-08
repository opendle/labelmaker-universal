import {
  printerVerticalGeometry,
  type RasterAlignment,
} from "@labelmaker/printing";

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

export function printableVerticalCrop(
  plateHeightMm: number,
  margins: PrintableMargins,
) {
  const { topMm, bottomMm, heightMm } = printerVerticalGeometry(
    plateHeightMm,
    plateHeightMm,
    Math.max(0, margins.topMm),
    Math.max(0, margins.bottomMm),
  );
  return { topMm, bottomMm, heightMm };
}

export function nonPrintableMarginsMm(
  plateHeightMm: number,
  printHeadSizeMm: number | undefined,
  configuredTopMm = 0,
  configuredBottomMm = 0,
  rasterAlignment: RasterAlignment = "center",
): PrintableMargins {
  if (printHeadSizeMm === undefined) return { topMm: 0, bottomMm: 0 };
  const { topMm, bottomMm } = printerVerticalGeometry(
    plateHeightMm,
    printHeadSizeMm,
    configuredTopMm,
    configuredBottomMm,
    rasterAlignment,
  );
  return { topMm, bottomMm };
}

export function displayMillimeters(value: number): number {
  return Math.round(value * 10) / 10;
}
