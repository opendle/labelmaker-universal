import type { CSSProperties } from "react";

import { displayMillimeters, type PrintableMargins } from "./label-layout.js";

type GridStyle = CSSProperties & Record<`--${string}`, string | number>;
type RulerStyle = CSSProperties & Record<`--${string}`, string | number>;

const DIMENSION_MERGE_TOLERANCE_MM = 0.05;

export function CanvasGrid({
  widthMm,
  heightMm,
  canvasScale,
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
}) {
  const fadeDistanceMm = 10;
  const marks = (lengthMm: number) =>
    Array.from(
      { length: Math.ceil((lengthMm + fadeDistanceMm * 2) / 5) + 1 },
      (_, index) => index * 5 - fadeDistanceMm,
    );
  const opacity = (mark: number, lengthMm: number) =>
    Math.max(0, 1 - Math.max(0, -mark, mark - lengthMm) / fadeDistanceMm);
  return (
    <div
      aria-hidden="true"
      className="canvas-grid"
      style={
        {
          "--grid-fade-distance": `${fadeDistanceMm * canvasScale}px`,
        } as GridStyle
      }
    >
      {marks(widthMm).map((mark) => (
        <span
          className="vertical"
          key={`x-${mark}`}
          style={{
            left: `${mark * canvasScale}px`,
            opacity: opacity(mark, widthMm),
          }}
        />
      ))}
      {marks(heightMm).map((mark) => (
        <span
          className="horizontal"
          key={`y-${mark}`}
          style={{
            opacity: opacity(mark, heightMm),
            top: `${mark * canvasScale}px`,
          }}
        />
      ))}
    </div>
  );
}

export function CanvasRulers({
  widthMm,
  heightMm,
  canvasScale,
  zoom,
  printableMargins,
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
  readonly zoom: number;
  readonly printableMargins: PrintableMargins;
}) {
  const horizontal = Array.from(
    { length: Math.floor(widthMm / 5) + 1 },
    (_, index) => index * 5,
  );
  const vertical = Array.from(
    { length: Math.floor(heightMm / 5) + 1 },
    (_, index) => index * 5,
  );
  const printableHeightMm = Math.max(
    0,
    heightMm - printableMargins.topMm - printableMargins.bottomMm,
  );
  const hasSeparatePrintableHeight =
    Math.abs(heightMm - printableHeightMm) > DIMENSION_MERGE_TOLERANCE_MM;
  const dimensionFontSize = Math.max(9.5, 9.5 * (zoom / 100));
  const intervalFontSize = Math.max(8, 8 * (zoom / 100));
  const rulerLayoutScale = Math.max(1, zoom / 100);
  const layoutStyle = {
    "--dimension-ruler-outer-offset": `${78 * rulerLayoutScale}px`,
    "--dimension-ruler-width-offset": `${36 * rulerLayoutScale}px`,
    "--dimension-ruler-inner-offset": `${60 * rulerLayoutScale}px`,
    "--interval-ruler-left-offset": `${48 * rulerLayoutScale}px`,
    "--interval-ruler-left-width": `${46 * rulerLayoutScale}px`,
    "--interval-ruler-top-height": `${22 * rulerLayoutScale}px`,
    "--interval-ruler-top-offset": `${24 * rulerLayoutScale}px`,
  } as RulerStyle;
  const dimensionStyle = {
    ...layoutStyle,
    "--dimension-ruler-font-size": `${dimensionFontSize}px`,
  } as RulerStyle;
  const intervalStyle = {
    ...layoutStyle,
    "--interval-ruler-font-size": `${intervalFontSize}px`,
  } as RulerStyle;
  return (
    <>
      <div
        aria-hidden="true"
        className="dimension-ruler dimension-ruler-width"
        style={dimensionStyle}
      >
        <span>{displayMillimeters(widthMm)} mm</span>
      </div>
      <div aria-hidden="true" className="ruler ruler-top" style={intervalStyle}>
        {horizontal.map((mark) => (
          <span
            className={mark === 0 ? "origin" : undefined}
            key={mark}
            style={{ left: `${mark * canvasScale}px` }}
          >
            {mark} mm
          </span>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="ruler ruler-left"
        style={intervalStyle}
      >
        {vertical.map((mark) => (
          <span
            className={mark === 0 ? "origin" : undefined}
            key={mark}
            style={{ top: `${mark * canvasScale}px` }}
          >
            {mark} mm
          </span>
        ))}
      </div>
      <div
        aria-hidden="true"
        className={`dimension-ruler dimension-ruler-height${hasSeparatePrintableHeight ? "" : " dimension-ruler-height-merged"}`}
        style={dimensionStyle}
      >
        <span>{displayMillimeters(heightMm)} mm</span>
      </div>
      {hasSeparatePrintableHeight ? (
        <div
          aria-hidden="true"
          className="dimension-ruler dimension-ruler-printable-height"
          style={{
            ...dimensionStyle,
            height: `${printableHeightMm * canvasScale}px`,
            top: `${printableMargins.topMm * canvasScale}px`,
          }}
        >
          <span>{displayMillimeters(printableHeightMm)} mm</span>
        </div>
      ) : null}
    </>
  );
}
