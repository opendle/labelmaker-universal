import type {
  ElementFrame,
  LabelElement,
  PhysicalSize,
} from "@labelmaker/domain";

import type { PrintableMargins } from "./label-layout.js";

export interface SnapThresholds {
  readonly xMm: number;
  readonly yMm: number;
}

function nearest(value: number, targets: readonly number[], threshold: number) {
  let result = value;
  let distance = threshold;
  for (const target of targets) {
    const nextDistance = Math.abs(value - target);
    if (nextDistance <= distance) {
      result = target;
      distance = nextDistance;
    }
  }
  return result;
}

export function snapMovedElement(
  element: LabelElement,
  size: PhysicalSize,
  margins: PrintableMargins,
  thresholds: SnapThresholds,
): LabelElement {
  const printableTop = margins.topMm;
  const printableBottom = size.heightMm - margins.bottomMm;
  return {
    ...element,
    xMm: nearest(
      element.xMm,
      [0, (size.widthMm - element.widthMm) / 2, size.widthMm - element.widthMm],
      thresholds.xMm,
    ),
    yMm: nearest(
      element.yMm,
      [
        0,
        printableTop,
        (printableTop + printableBottom - element.heightMm) / 2,
        printableBottom - element.heightMm,
        size.heightMm - element.heightMm,
      ],
      thresholds.yMm,
    ),
  };
}

export function snapResizedFrame<T extends ElementFrame>(
  frame: T,
  size: PhysicalSize,
  margins: PrintableMargins,
  thresholds: SnapThresholds,
  edges: { readonly left: boolean; readonly top: boolean },
): T {
  const minimumSizeMm = 0.5;
  const originalRight = frame.xMm + frame.widthMm;
  const originalBottom = frame.yMm + frame.heightMm;
  const printableTop = margins.topMm;
  const printableBottom = size.heightMm - margins.bottomMm;
  const xMm = edges.left ? nearest(frame.xMm, [0], thresholds.xMm) : frame.xMm;
  const yMm = edges.top
    ? nearest(frame.yMm, [0, printableTop], thresholds.yMm)
    : frame.yMm;
  const right = edges.left
    ? originalRight
    : nearest(originalRight, [size.widthMm], thresholds.xMm);
  const bottom = edges.top
    ? originalBottom
    : nearest(originalBottom, [printableBottom, size.heightMm], thresholds.yMm);
  return {
    ...frame,
    xMm: right - xMm < minimumSizeMm ? right - minimumSizeMm : xMm,
    yMm: bottom - yMm < minimumSizeMm ? bottom - minimumSizeMm : yMm,
    widthMm: Math.max(minimumSizeMm, right - xMm),
    heightMm: Math.max(minimumSizeMm, bottom - yMm),
  } as T;
}
