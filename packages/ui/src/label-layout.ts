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
  return Math.min(50, Math.max(0, (marginMm / plateHeightMm) * 100));
}

export function printableHeightMm(
  plateHeightMm: number,
  verticalMarginMm: number,
): number {
  return Math.max(0, plateHeightMm - verticalMarginMm * 2);
}

export function nonPrintableMarginMm(
  plateHeightMm: number,
  printableWidthMm: number | undefined,
): number {
  if (printableWidthMm === undefined) return 0;
  return Math.max(0, (plateHeightMm - printableWidthMm) / 2);
}

export function displayMillimeters(value: number): number {
  return Math.round(value * 10) / 10;
}
