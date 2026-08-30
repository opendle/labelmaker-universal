import type { LabelPlate } from "@labelmaker/domain";

import type { PrintableMargins } from "./label-layout.js";

export const NEW_TEXT_WIDTH_MM = 40;
const MIN_ELEMENT_SIZE_MM = 0.1;
const MAX_ELEMENT_SIZE_MM = 10_000;

const DEFAULT_PRINTABLE_MARGINS: PrintableMargins = {
  topMm: 0,
  bottomMm: 0,
};

export function newElementFrame(
  plate: LabelPlate,
  widthMm: number,
  printableMargins: PrintableMargins = DEFAULT_PRINTABLE_MARGINS,
) {
  const validWidthMm = Math.min(
    MAX_ELEMENT_SIZE_MM,
    Math.max(MIN_ELEMENT_SIZE_MM, widthMm),
  );
  const topMm = Math.min(
    plate.size.heightMm,
    Math.max(0, printableMargins.topMm),
  );
  const bottomMm = Math.min(
    plate.size.heightMm - topMm,
    Math.max(0, printableMargins.bottomMm),
  );
  const heightMm = Math.max(
    MIN_ELEMENT_SIZE_MM,
    plate.size.heightMm - topMm - bottomMm,
  );
  return {
    xMm: (plate.size.widthMm - validWidthMm) / 2,
    yMm: topMm,
    widthMm: validWidthMm,
    heightMm,
  };
}
