import type { ShapeElement } from "@labelmaker/domain";

type ShapeFrame = Pick<
  ShapeElement,
  "cornerRadiusMm" | "filled" | "heightMm" | "strokeWidthMm" | "widthMm"
>;

export interface ShapeRenderGeometry {
  readonly cornerRadiusMm: number;
  readonly filled: boolean;
  readonly heightMm: number;
  readonly insetMm: number;
  readonly strokeWidthMm: number;
  readonly widthMm: number;
}

export function shapeLineStrokeWidthMm(element: ShapeFrame): number {
  return Math.min(
    Math.max(0, element.strokeWidthMm),
    Math.max(0, element.heightMm),
  );
}

export function shapeRenderGeometry(element: ShapeFrame): ShapeRenderGeometry {
  const widthMm = Math.max(0, element.widthMm);
  const heightMm = Math.max(0, element.heightMm);
  const minimumSizeMm = Math.min(widthMm, heightMm);
  const requestedStrokeWidthMm = Math.max(0, element.strokeWidthMm);
  const filled = element.filled || requestedStrokeWidthMm >= minimumSizeMm;
  const strokeWidthMm = filled
    ? 0
    : Math.min(requestedStrokeWidthMm, minimumSizeMm);
  const insetMm = strokeWidthMm / 2;
  const innerWidthMm = widthMm - strokeWidthMm;
  const innerHeightMm = heightMm - strokeWidthMm;
  const cornerRadiusMm = Math.max(
    0,
    Math.min(
      element.cornerRadiusMm - insetMm,
      innerWidthMm / 2,
      innerHeightMm / 2,
    ),
  );

  return {
    cornerRadiusMm: filled
      ? Math.max(0, Math.min(element.cornerRadiusMm, widthMm / 2, heightMm / 2))
      : cornerRadiusMm,
    filled,
    heightMm: innerHeightMm,
    insetMm,
    strokeWidthMm,
    widthMm: innerWidthMm,
  };
}
