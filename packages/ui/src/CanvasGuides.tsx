import type { CSSProperties } from "react";

type GridStyle = CSSProperties & Record<`--${string}`, string | number>;

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
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
}) {
  const horizontal = Array.from(
    { length: Math.floor(widthMm / 5) + 1 },
    (_, index) => index * 5,
  );
  const vertical = Array.from(
    { length: Math.floor(heightMm / 5) + 1 },
    (_, index) => index * 5,
  );
  return (
    <>
      <div aria-hidden="true" className="ruler ruler-top">
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
      <div aria-hidden="true" className="ruler ruler-left">
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
    </>
  );
}
