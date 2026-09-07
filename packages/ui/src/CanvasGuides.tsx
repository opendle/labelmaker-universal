import type { LabelPlate } from "@labelmaker/domain";
import { useEffect, useRef, type CSSProperties } from "react";

import { updatePlateEditorHeight } from "./editor-operations.js";
import { displayMillimeters, type PrintableMargins } from "./label-layout.js";
import { NumberInput } from "./NumberInput.js";

type GridStyle = CSSProperties & Record<`--${string}`, string | number>;
type RulerStyle = CSSProperties & Record<`--${string}`, string | number>;

const DIMENSION_MERGE_TOLERANCE_MM = 0.05;

function EditableDimension({
  label,
  value,
  min,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly onChange: (value: number) => void;
}) {
  const fieldRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const blurOutside = (event: PointerEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        fieldRef.current?.contains(active) &&
        event.target !== active
      ) {
        active.blur();
      }
    };
    document.addEventListener("pointerdown", blurOutside, true);
    return () => document.removeEventListener("pointerdown", blurOutside, true);
  }, []);

  return (
    <span className="dimension-value" ref={fieldRef}>
      <NumberInput
        aria-label={label}
        inputMode="decimal"
        min={min}
        normalizeValue={(next) => Math.max(min, next)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.blur();
        }}
        onValueChange={onChange}
        step={0.1}
        style={{ width: `${Math.max(1, String(value).length)}ch` }}
        title={label}
        value={value}
      />
      <b aria-hidden="true">mm</b>
    </span>
  );
}

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
  editing,
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
  readonly zoom: number;
  readonly printableMargins: PrintableMargins;
  readonly editing?: {
    readonly plate: LabelPlate;
    readonly onChange: (plate: LabelPlate) => void;
  };
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
  const rulerZoomScale = Math.max(1, 1 + (zoom - 100) / 400);
  const dimensionFontSize = 9 * rulerZoomScale;
  const intervalFontSize = 7.5 * rulerZoomScale;
  const intervalTopOffset = 20;
  const intervalLeftOffset = 40;
  const topDimensionTierGap = 10;
  const leftDimensionTierGap = 0;
  const verticalDimensionGap = 18;
  const dimensionInnerOffset = intervalLeftOffset + leftDimensionTierGap;
  const layoutStyle = {
    "--dimension-ruler-outer-offset": `${(dimensionInnerOffset + verticalDimensionGap) * rulerZoomScale}px`,
    "--dimension-ruler-width-offset": `${(intervalTopOffset + topDimensionTierGap) * rulerZoomScale}px`,
    "--dimension-ruler-inner-offset": `${dimensionInnerOffset * rulerZoomScale}px`,
    "--interval-ruler-left-offset": `${intervalLeftOffset * rulerZoomScale}px`,
    "--interval-ruler-left-width": `${38 * rulerZoomScale}px`,
    "--interval-ruler-top-height": `${18 * rulerZoomScale}px`,
    "--interval-ruler-top-offset": `${intervalTopOffset * rulerZoomScale}px`,
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
        aria-hidden={editing ? undefined : true}
        className={`dimension-ruler dimension-ruler-height${hasSeparatePrintableHeight ? "" : " dimension-ruler-height-merged"}`}
        style={dimensionStyle}
      >
        {editing ? (
          <EditableDimension
            label="Plate height"
            min={1}
            onChange={(next) =>
              editing.onChange(updatePlateEditorHeight(editing.plate, next))
            }
            value={Math.round(heightMm * 10) / 10}
          />
        ) : (
          <span>{displayMillimeters(heightMm)} mm</span>
        )}
      </div>
      {editing
        ? (["leftMm", "rightMm"] as const).map((side) => (
            <div
              className={`dimension-ruler dimension-ruler-margin dimension-ruler-margin-${side === "leftMm" ? "left" : "right"}`}
              key={side}
              style={{
                ...dimensionStyle,
                width: `${editing.plate.margins[side] * canvasScale}px`,
              }}
            >
              <EditableDimension
                label={side === "leftMm" ? "Left margin" : "Right margin"}
                min={0}
                onChange={(next) =>
                  editing.onChange({
                    ...editing.plate,
                    margins: { ...editing.plate.margins, [side]: next },
                  })
                }
                value={Math.round(editing.plate.margins[side] * 10) / 10}
              />
            </div>
          ))
        : null}
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
