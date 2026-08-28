import type { ImageElement, LabelPlate, TextElement } from "@labelmaker/domain";
import {
  AlignCenter,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  Crop,
  Italic,
  RotateCcw,
  X,
} from "lucide-react";
import { useState } from "react";

import { IconButton } from "./controls.js";
import {
  plateEditorWidthMm,
  updatePlateEditorWidth,
} from "./editor-operations.js";
import { TYPEFACES } from "./typefaces.js";

function NumberField({
  label,
  shortLabel,
  value,
  unit = "mm",
  min,
  icon,
  onChange,
  step,
}: {
  readonly label: string;
  readonly shortLabel: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly icon?: boolean;
  readonly onChange: (value: number) => void;
  readonly step?: number;
}) {
  return (
    <label className="field">
      <span>{shortLabel}</span>
      <div className="unit-input">
        {icon && <RotateCcw size={14} />}
        <input
          aria-label={label}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={Math.round(value * 10) / 10}
        />
        <b>{unit}</b>
      </div>
    </label>
  );
}

function LineHeightField({
  element,
  onChange,
}: {
  readonly element: TextElement;
  readonly onChange: (element: TextElement) => void;
}) {
  const enabled = element.lineHeightPt !== undefined;
  const [emptyDraft, setEmptyDraft] = useState(false);
  return (
    <div className="field line-height-field">
      <span className="field-heading">
        LINE HEIGHT
        <label className="auto-setting">
          <input
            aria-label="Use automatic line height"
            checked={!enabled}
            onChange={(event) => {
              setEmptyDraft(false);
              if (event.target.checked) {
                const { lineHeightPt: _lineHeightPt, ...automatic } = element;
                onChange(automatic);
              } else {
                onChange({ ...element, lineHeightPt: element.fontSizePt });
              }
            }}
            type="checkbox"
          />
          AUTO
        </label>
      </span>
      <div className="unit-input">
        <input
          aria-label="Line height"
          disabled={!enabled}
          min={0.1}
          onBlur={() => setEmptyDraft(false)}
          onChange={(event) => {
            if (event.target.value.trim() === "") {
              setEmptyDraft(true);
              return;
            }
            const lineHeightPt = Number(event.target.value);
            if (!Number.isFinite(lineHeightPt)) return;
            setEmptyDraft(false);
            onChange({
              ...element,
              lineHeightPt: Math.max(0.1, lineHeightPt),
            });
          }}
          step={0.1}
          type="number"
          value={
            emptyDraft
              ? ""
              : Math.round((element.lineHeightPt ?? element.fontSizePt) * 10) /
                10
          }
        />
        <b>pt</b>
      </div>
    </div>
  );
}

function TextInspector({
  element,
  onChange,
}: {
  readonly element: TextElement;
  readonly onChange: (element: TextElement) => void;
}) {
  return (
    <div className="property-stack">
      <label className="field full">
        <span>TYPEFACE</span>
        <select
          aria-label="Typeface"
          onChange={(event) =>
            onChange({ ...element, fontFamily: event.target.value })
          }
          value={element.fontFamily}
        >
          {TYPEFACES.map((typeface) => (
            <option key={typeface.label} value={typeface.value}>
              {typeface.label}
            </option>
          ))}
        </select>
      </label>
      <div className="field-row">
        <NumberField
          label="Font size"
          shortLabel="SIZE"
          unit="pt"
          value={element.fontSizePt}
          onChange={(fontSizePt) => onChange({ ...element, fontSizePt })}
        />
        <LineHeightField element={element} onChange={onChange} />
      </div>
      <div className="field">
        <span>WEIGHT &amp; STYLE</span>
        <div className="text-style-buttons" aria-label="Weight and style">
          <span className="weight-group">
            {[300, 400, 600, 700].map((fontWeight) => (
              <button
                aria-label={
                  fontWeight === 300
                    ? "Light"
                    : fontWeight === 400
                      ? "Regular"
                      : fontWeight === 600
                        ? "Semi bold"
                        : "Bold"
                }
                className={`weight-button weight-${fontWeight} ${element.fontWeight === fontWeight ? "active" : ""}`}
                key={fontWeight}
                onClick={() => onChange({ ...element, fontWeight })}
                style={{ fontWeight }}
                type="button"
              >
                B
              </button>
            ))}
          </span>
          <button
            aria-label="Italic"
            aria-pressed={element.fontStyle === "italic"}
            className={`italic-button ${element.fontStyle === "italic" ? "active" : ""}`}
            onClick={() =>
              onChange({
                ...element,
                fontStyle: element.fontStyle === "italic" ? "normal" : "italic",
              })
            }
            type="button"
          >
            <Italic size={14} />
          </button>
        </div>
      </div>
      <div className="alignment-row">
        <div className="alignment-group">
          <div className="property-label">HORIZONTAL</div>
          <div className="segmented">
            {(["left", "center", "right"] as const).map((align) => (
              <button
                aria-label={`Align ${align}`}
                aria-pressed={element.align === align}
                className={element.align === align ? "active" : ""}
                key={align}
                onClick={() => onChange({ ...element, align })}
                type="button"
              >
                {align === "left" ? (
                  <AlignLeft size={16} />
                ) : align === "center" ? (
                  <AlignCenter size={16} />
                ) : (
                  <AlignRight size={16} />
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="alignment-group">
          <div className="property-label">VERTICAL</div>
          <div className="segmented">
            {(["top", "middle", "bottom"] as const).map((verticalAlign) => (
              <button
                aria-label={`Align ${verticalAlign}`}
                aria-pressed={
                  (element.verticalAlign ?? "middle") === verticalAlign
                }
                className={
                  (element.verticalAlign ?? "middle") === verticalAlign
                    ? "active"
                    : ""
                }
                key={verticalAlign}
                onClick={() => onChange({ ...element, verticalAlign })}
                type="button"
              >
                {verticalAlign === "top" ? (
                  <AlignStartVertical size={16} />
                ) : verticalAlign === "middle" ? (
                  <AlignVerticalJustifyCenter size={16} />
                ) : (
                  <AlignEndVertical size={16} />
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="property-label">POSITION</div>
      <div className="field-row position-row">
        <NumberField
          label="X position"
          shortLabel="X"
          value={element.xMm}
          onChange={(xMm) => onChange({ ...element, xMm })}
        />
        <NumberField
          label="Y position"
          shortLabel="Y"
          value={element.yMm}
          onChange={(yMm) => onChange({ ...element, yMm })}
        />
      </div>
      <NumberField
        icon
        label="Rotation"
        shortLabel="ROTATION"
        unit="°"
        value={element.rotationDeg}
        onChange={(rotationDeg) => onChange({ ...element, rotationDeg })}
      />
    </div>
  );
}

function ImageInspector({
  element,
  onChange,
}: {
  readonly element: ImageElement;
  readonly onChange: (element: ImageElement) => void;
}) {
  return (
    <div className="property-stack">
      <div className="image-inspector-preview">
        <img alt="Selected" src={element.source} />
      </div>
      <label className="field full">
        <span>FIT</span>
        <select
          aria-label="Image fit"
          onChange={(event) =>
            onChange({
              ...element,
              fit: event.target.value as ImageElement["fit"],
            })
          }
          value={element.fit}
        >
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="stretch">Stretch</option>
        </select>
      </label>
      <div className="property-label">POSITION</div>
      <div className="field-row">
        <NumberField
          label="Image X position"
          shortLabel="X"
          value={element.xMm}
          onChange={(xMm) => onChange({ ...element, xMm })}
        />
        <NumberField
          label="Image Y position"
          shortLabel="Y"
          value={element.yMm}
          onChange={(yMm) => onChange({ ...element, yMm })}
        />
      </div>
      <div className="property-label">SIZE</div>
      <div className="field-row">
        <NumberField
          label="Image width"
          min={1}
          shortLabel="WIDTH"
          value={element.widthMm}
          onChange={(widthMm) =>
            onChange({ ...element, widthMm: Math.max(1, widthMm) })
          }
        />
        <NumberField
          label="Image height"
          min={1}
          shortLabel="HEIGHT"
          value={element.heightMm}
          onChange={(heightMm) =>
            onChange({ ...element, heightMm: Math.max(1, heightMm) })
          }
        />
      </div>
      <NumberField
        icon
        label="Image rotation"
        shortLabel="ROTATION"
        unit="°"
        value={element.rotationDeg}
        onChange={(rotationDeg) => onChange({ ...element, rotationDeg })}
      />
    </div>
  );
}

export function PlateToolbarSettings({
  plate,
  onChange,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly onChange: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
}) {
  return (
    <div className="plate-toolbar-settings">
      <label className="toolbar-field plate-name-field">
        <span>NAME</span>
        <input
          aria-label="Plate name"
          onChange={(event) => onChange({ ...plate, name: event.target.value })}
          value={plate.name}
        />
      </label>
      <label className="toolbar-field width-field">
        <span>WIDTH</span>
        <div className="toolbar-unit-input">
          <input
            aria-label="Plate width"
            min={1}
            onChange={(event) =>
              onChange(
                updatePlateEditorWidth(
                  plate,
                  Math.max(1, Math.round(Number(event.target.value))),
                ),
              )
            }
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onTrim();
            }}
            step={1}
            type="number"
            value={plateEditorWidthMm(plate)}
          />
          <b>mm</b>
          <button
            aria-label="Trim plate to content"
            className="inline-trim-button"
            onClick={onTrim}
            title="Trim width to printed content and margins"
            type="button"
          >
            <Crop size={14} />
          </button>
        </div>
      </label>
      {[
        ["Plate height", "HEIGHT", plate.size.heightMm],
        ["Left margin", "LEFT", plate.margins.leftMm],
        ["Right margin", "RIGHT", plate.margins.rightMm],
      ].map(([label, shortLabel, value]) => (
        <label className="toolbar-field" key={label}>
          <span>{shortLabel}</span>
          <div className="toolbar-unit-input">
            <input
              aria-label={label as string}
              min={label === "Plate height" ? 1 : 0}
              onChange={(event) => {
                const next = Math.max(
                  label === "Plate height" ? 1 : 0,
                  Number(event.target.value),
                );
                if (label === "Plate height") {
                  onChange({
                    ...plate,
                    size: { ...plate.size, heightMm: next },
                  });
                } else {
                  onChange({
                    ...plate,
                    margins: {
                      ...plate.margins,
                      [label === "Left margin" ? "leftMm" : "rightMm"]: next,
                    },
                  });
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onTrim();
              }}
              type="number"
              value={Math.round((value as number) * 10) / 10}
            />
            <b>mm</b>
          </div>
        </label>
      ))}
    </div>
  );
}

export function Inspector({
  selectedText,
  selectedImage,
  onClearSelection,
  onUpdateText,
  onUpdateImage,
}: {
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly onClearSelection: () => void;
  readonly onUpdateText: (element: TextElement) => void;
  readonly onUpdateImage: (element: ImageElement) => void;
}) {
  return (
    <aside className="inspector">
      {(selectedText || selectedImage) && (
        <div className="inspector-header">
          <span>
            {selectedText ? "Text" : selectedImage ? "Image" : "Plate"}
          </span>
          {(selectedText || selectedImage) && (
            <IconButton label="Clear selection" onClick={onClearSelection}>
              <X size={15} />
            </IconButton>
          )}
        </div>
      )}
      {selectedText ? (
        <TextInspector element={selectedText} onChange={onUpdateText} />
      ) : selectedImage ? (
        <ImageInspector element={selectedImage} onChange={onUpdateImage} />
      ) : (
        <div className="empty-inspector">Select an element to change it.</div>
      )}
    </aside>
  );
}
