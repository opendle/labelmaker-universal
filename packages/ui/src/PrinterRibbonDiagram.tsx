import type { CSSProperties } from "react";
import { EditableDimension } from "./EditableDimension.js";

export interface PrinterGeometryDraft {
  readonly printHeadSizeMm: string;
  readonly marginTopMm: string;
  readonly marginBottomMm: string;
  readonly interLabelSpacingMm: string;
}

type RibbonStyle = CSSProperties & Record<`--${string}`, string | number>;

function previewMillimeters(value: string, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(100, Math.max(minimum, parsed))
    : minimum;
}

export function PrinterRibbonDiagram({
  values,
  disabled,
  onChange,
}: {
  readonly values: PrinterGeometryDraft;
  readonly disabled: boolean;
  readonly onChange: (field: keyof PrinterGeometryDraft, value: string) => void;
}) {
  const head = previewMillimeters(values.printHeadSizeMm, 0.1);
  const top = previewMillimeters(values.marginTopMm);
  const bottom = previewMillimeters(values.marginBottomMm);
  const gap = previewMillimeters(values.interLabelSpacingMm);
  const height = top + head + bottom;
  const length = 44 + gap;
  const fields = [
    {
      key: "marginTopMm",
      label: "Top margin",
      description: "Top margin: ribbon above the printable area",
      className: "printer-ruler-top",
      start: 0,
      size: top,
    },
    {
      key: "printHeadSizeMm",
      label: "Print head size",
      description: "Print head size: height of the printable area",
      className: "printer-ruler-head",
      start: top,
      size: head,
    },
    {
      key: "marginBottomMm",
      label: "Bottom margin",
      description: "Bottom margin: ribbon below the printable area",
      className: "printer-ruler-bottom",
      start: top + head,
      size: bottom,
    },
  ] as const;
  return (
    <div className="printer-label-schematic">
      <div
        className="printer-ribbon-preview"
        style={
          {
            "--ribbon-height-mm": height,
            "--ribbon-length-mm": length,
            "--ribbon-top-mm": top,
            "--ribbon-bottom-mm": bottom,
            "--ribbon-gap-mm": gap,
          } as RibbonStyle
        }
      >
        <div className="printer-ribbon" aria-hidden="true">
          <div className="printer-ribbon-gap" />
          <svg viewBox={`0 0 ${length} ${height}`} width="100%" height="100%">
            {[15, 45 + gap].map((x) => (
              <text
                key={x}
                x={x}
                y={top + head / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.min(3, head / 2)}
              >
                Label
              </text>
            ))}
          </svg>
          <div
            className="nonprintable-zone top"
            style={{ height: "calc(var(--ribbon-top-mm) * var(--ribbon-mm))" }}
          />
          <div
            className="nonprintable-zone bottom"
            style={{
              height: "calc(var(--ribbon-bottom-mm) * var(--ribbon-mm))",
            }}
          />
        </div>
        <div
          className="dimension-ruler dimension-ruler-width printer-ruler-length"
          aria-hidden="true"
        >
          <span>30 mm</span>
        </div>
        {fields.map((field) => (
          <div
            key={field.key}
            className={`dimension-ruler dimension-ruler-height ${field.className}`}
            style={{
              top: `calc(${field.start} * var(--ribbon-mm))`,
              height: `calc(${field.size} * var(--ribbon-mm))`,
            }}
          >
            <EditableDimension
              mode="draft"
              label={field.label}
              description={field.description}
              min={field.key === "printHeadSizeMm" ? 0.1 : 0}
              max={100}
              disabled={disabled}
              value={values[field.key]}
              onChange={(value) => onChange(field.key, value)}
            />
          </div>
        ))}
        <div className="dimension-ruler dimension-ruler-margin printer-ruler-gap">
          <EditableDimension
            mode="draft"
            label="Margin between labels"
            description="Label gap: space between two labels"
            min={0}
            max={100}
            disabled={disabled}
            value={values.interLabelSpacingMm}
            onChange={(value) => onChange("interLabelSpacingMm", value)}
          />
        </div>
      </div>
    </div>
  );
}
