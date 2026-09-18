import {
  printerVerticalGeometry,
  type RasterAlignment,
} from "@labelmaker/printing";
import type { CSSProperties } from "react";
import { EditableDimension } from "./EditableDimension.js";

export interface PrinterGeometryDraft {
  readonly printHeadSizeMm: string;
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
  rasterAlignment = "center",
  disabled,
  onChange,
}: {
  readonly values: PrinterGeometryDraft;
  readonly rasterAlignment?: RasterAlignment | undefined;
  readonly disabled: boolean;
  readonly onChange: (field: keyof PrinterGeometryDraft, value: string) => void;
}) {
  const head = previewMillimeters(values.printHeadSizeMm, 0.1);
  const gap = previewMillimeters(values.interLabelSpacingMm);
  // Example paper is wider than the head so its blank edges remain visible.
  const height = head + 4;
  const geometry = printerVerticalGeometry(height, head, rasterAlignment);
  const length = 44 + gap;
  return (
    <div className="printer-label-schematic">
      <div
        className="printer-ribbon-preview"
        style={
          {
            "--ribbon-height-mm": height,
            "--ribbon-length-mm": length,
            "--ribbon-gap-mm": gap,
            "--ribbon-head-mm": head,
            "--ribbon-top-mm": geometry.topMm,
            "--ribbon-bottom-mm": geometry.bottomMm,
          } as RibbonStyle
        }
      >
        <div className="printer-ribbon" aria-hidden="true">
          <div className="printer-ribbon-head" />
          {geometry.topMm > 0 && <div className="printer-paper-blank top" />}
          {geometry.bottomMm > 0 && (
            <div className="printer-paper-blank bottom" />
          )}
          <div className="printer-ribbon-gap" />
        </div>
        <span className="printer-ribbon-label">Printhead area</span>
        <div
          className="dimension-ruler dimension-ruler-height printer-ruler-head"
          style={{
            top: "calc(var(--ribbon-top-mm) * var(--ribbon-mm))",
            height: "calc(var(--ribbon-head-mm) * var(--ribbon-mm))",
          }}
        >
          <div className="printer-dimension-caption">
            <span>Print head size</span>
            <EditableDimension
              mode="draft"
              label="Print head size"
              description="Print head size: physical head dimension across the paper"
              min={0.1}
              max={100}
              disabled={disabled}
              value={values.printHeadSizeMm}
              onChange={(value) => onChange("printHeadSizeMm", value)}
            />
          </div>
        </div>
        <div className="dimension-ruler dimension-ruler-margin printer-ruler-gap">
          <div className="printer-dimension-caption">
            <span>Between labels</span>
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
    </div>
  );
}
