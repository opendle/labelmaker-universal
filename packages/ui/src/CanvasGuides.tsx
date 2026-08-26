export function CanvasGrid({
  widthMm,
  heightMm,
  canvasScale,
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
}) {
  const overscanMm = Math.ceil(120 / canvasScale / 5) * 5;
  const marks = (lengthMm: number) =>
    Array.from(
      { length: Math.ceil((lengthMm + overscanMm * 2) / 5) + 1 },
      (_, index) => index * 5 - overscanMm,
    );
  return (
    <div aria-hidden="true" className="canvas-grid">
      {marks(widthMm).map((mark) => (
        <span
          className="vertical"
          key={`x-${mark}`}
          style={{ left: `${mark * canvasScale}px` }}
        />
      ))}
      {marks(heightMm).map((mark) => (
        <span
          className="horizontal"
          key={`y-${mark}`}
          style={{ top: `${mark * canvasScale}px` }}
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
