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

export function printableHeightMm(
  plateHeightMm: number,
  margins: PrintableMargins,
): number {
  return Math.max(0, plateHeightMm - margins.topMm - margins.bottomMm);
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
): PrintableMargins {
  if (printHeadSizeMm === undefined) return { topMm: 0, bottomMm: 0 };
  const nominalMediaHeightMm =
    configuredTopMm + printHeadSizeMm + configuredBottomMm;
  const mediaAdjustmentMm = (plateHeightMm - nominalMediaHeightMm) / 2;
  return {
    topMm: Math.max(0, configuredTopMm + mediaAdjustmentMm),
    bottomMm: Math.max(0, configuredBottomMm + mediaAdjustmentMm),
  };
}

export function displayMillimeters(value: number): number {
  return Math.round(value * 10) / 10;
}
