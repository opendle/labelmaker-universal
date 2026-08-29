import type {
  ImageElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  BringToFront,
  Crop,
  Italic,
  RotateCcw,
  SendToBack,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { IconButton } from "./controls.js";
import {
  plateEditorWidthMm,
  updatePlateEditorHeight,
  updatePlateEditorWidth,
} from "./editor-operations.js";
import { TYPEFACES } from "./typefaces.js";
import { MonochromeImage } from "./MonochromeImage.js";

function NumberField({
  label,
  shortLabel,
  value,
  unit = "mm",
  min,
  icon,
  onChange,
  step,
  integer = false,
}: {
  readonly label: string;
  readonly shortLabel: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly icon?: boolean;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly integer?: boolean;
}) {
  return (
    <label className="field">
      <span>{shortLabel}</span>
      <div className="unit-input">
        {icon && <RotateCcw size={14} />}
        <input
          aria-label={label}
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isFinite(next)) return;
            onChange(integer ? Math.round(next) : next);
          }}
          step={step}
          type="number"
          value={integer ? Math.round(value) : Math.round(value * 10) / 10}
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
  const toggleAutomatic = () => {
    setEmptyDraft(false);
    if (enabled) {
      const { lineHeightPt: _lineHeightPt, ...automatic } = element;
      onChange(automatic);
    } else {
      onChange({ ...element, lineHeightPt: element.fontSizePt });
    }
  };
  return (
    <div className="field line-height-field">
      <span>LINE HEIGHT</span>
      <div className="unit-input">
        <button
          aria-label="Use automatic line height"
          aria-pressed={!enabled}
          className={`auto-line-height-toggle${enabled ? "" : " active"}`}
          onClick={toggleAutomatic}
          title="Automatic line height"
          type="button"
        >
          <Sparkles size={13} />
        </button>
        <input
          aria-label="Line height"
          disabled={!enabled}
          inputMode="decimal"
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

type FramedElement = TextElement | ImageElement | ShapeElement;

function FrameControls<T extends FramedElement>({
  element,
  elementName,
  positionName = elementName,
  minSize,
  hasMultipleElements,
  onChange,
  onMoveLayer,
}: {
  readonly element: T;
  readonly elementName: string;
  readonly positionName?: string;
  readonly minSize: number;
  readonly hasMultipleElements: boolean;
  readonly onChange: (element: T) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  return (
    <>
      <div className="field-row">
        <NumberField
          label={`${elementName} width`}
          min={minSize}
          shortLabel="WIDTH"
          step={0.1}
          value={element.widthMm}
          onChange={(widthMm) =>
            onChange({ ...element, widthMm: Math.max(minSize, widthMm) })
          }
        />
        <NumberField
          label={`${elementName} height`}
          min={minSize}
          shortLabel="HEIGHT"
          step={0.1}
          value={element.heightMm}
          onChange={(heightMm) =>
            onChange({ ...element, heightMm: Math.max(minSize, heightMm) })
          }
        />
      </div>
      <div className="field-row position-row">
        <NumberField
          label={`${positionName ? `${positionName} ` : ""}X position`}
          shortLabel="X"
          step={0.1}
          value={element.xMm}
          onChange={(xMm) => onChange({ ...element, xMm })}
        />
        <NumberField
          label={`${positionName ? `${positionName} ` : ""}Y position`}
          shortLabel="Y"
          step={0.1}
          value={element.yMm}
          onChange={(yMm) => onChange({ ...element, yMm })}
        />
      </div>
      <NumberField
        icon
        label={`${elementName} rotation`}
        shortLabel="ROTATION"
        unit="°"
        value={element.rotationDeg}
        onChange={(rotationDeg) => onChange({ ...element, rotationDeg })}
      />
      {hasMultipleElements && (
        <fieldset aria-label="Layer order" className="layer-buttons">
          <button onClick={() => onMoveLayer("back")} type="button">
            <SendToBack size={14} /> Send to back
          </button>
          <button onClick={() => onMoveLayer("front")} type="button">
            <BringToFront size={14} /> Bring to front
          </button>
        </fieldset>
      )}
    </>
  );
}

function TextInspector({
  element,
  hasMultipleElements,
  onChange,
  onMoveLayer,
}: {
  readonly element: TextElement;
  readonly hasMultipleElements: boolean;
  readonly onChange: (element: TextElement) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  return (
    <div className="property-stack">
      <label className="field full">
        <span>TYPEFACE</span>
        <select
          aria-label="Typeface"
          className="typeface-select"
          onChange={(event) =>
            onChange({ ...element, fontFamily: event.target.value })
          }
          style={{ fontFamily: element.fontFamily }}
          value={element.fontFamily}
        >
          {TYPEFACES.map((typeface) => (
            <option key={typeface.label} value={typeface.value}>
              {typeface.label}
            </option>
          ))}
        </select>
      </label>
      <div className="type-metrics-row">
        <NumberField
          integer
          label="Font size"
          min={1}
          shortLabel="SIZE"
          step={1}
          unit="pt"
          value={element.fontSizePt}
          onChange={(fontSizePt) =>
            onChange({ ...element, fontSizePt: Math.max(1, fontSizePt) })
          }
        />
        <LineHeightField element={element} onChange={onChange} />
      </div>
      <fieldset aria-label="Weight and style" className="text-style-buttons">
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
              aria-pressed={element.fontWeight === fontWeight}
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
      </fieldset>
      <div className="alignment-row">
        <fieldset aria-label="Horizontal alignment" className="alignment-group">
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
        </fieldset>
        <fieldset aria-label="Vertical alignment" className="alignment-group">
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
                  <AlignVerticalJustifyStart size={16} />
                ) : verticalAlign === "middle" ? (
                  <AlignVerticalJustifyCenter size={16} />
                ) : (
                  <AlignVerticalJustifyEnd size={16} />
                )}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <FrameControls
        element={element}
        elementName="Text frame"
        hasMultipleElements={hasMultipleElements}
        minSize={0.5}
        onChange={onChange}
        onMoveLayer={onMoveLayer}
        positionName=""
      />
    </div>
  );
}

function ImageInspector({
  element,
  hasMultipleElements,
  onChange,
  onMoveLayer,
}: {
  readonly element: ImageElement;
  readonly hasMultipleElements: boolean;
  readonly onChange: (element: ImageElement) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  return (
    <div className="property-stack">
      <div className="image-inspector-preview">
        <MonochromeImage element={element} label="Selected image" />
      </div>
      <div className="image-fit-row">
        <label className="field full image-fit-select">
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
        <button
          aria-label="Transparent image background"
          aria-pressed={element.transparentBackground !== false}
          className={`image-background-toggle${element.transparentBackground !== false ? " active" : ""}`}
          onClick={() =>
            onChange({
              ...element,
              transparentBackground: element.transparentBackground === false,
            })
          }
          type="button"
        >
          Transparent
        </button>
      </div>
      <label className="field image-tone-field">
        <span>
          BRIGHTNESS <b>{element.brightness}</b>
        </span>
        <input
          aria-label="Image brightness"
          max={255}
          min={0}
          onChange={(event) =>
            onChange({ ...element, brightness: Number(event.target.value) })
          }
          type="range"
          value={element.brightness}
        />
      </label>
      <label className="field image-tone-field">
        <span>
          CONTRAST <b>{element.contrast}</b>
        </span>
        <input
          aria-label="Image contrast"
          max={255}
          min={0}
          onChange={(event) =>
            onChange({ ...element, contrast: Number(event.target.value) })
          }
          type="range"
          value={element.contrast}
        />
      </label>
      <FrameControls
        element={element}
        elementName="Image"
        hasMultipleElements={hasMultipleElements}
        minSize={1}
        onChange={onChange}
        onMoveLayer={onMoveLayer}
      />
    </div>
  );
}

function ShapeInspector({
  element,
  hasMultipleElements,
  onChange,
  onMoveLayer,
}: {
  readonly element: ShapeElement;
  readonly hasMultipleElements: boolean;
  readonly onChange: (element: ShapeElement) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  return (
    <div className="property-stack">
      <label className="field full">
        <span>SHAPE</span>
        <select
          aria-label="Shape type"
          onChange={(event) =>
            onChange({
              ...element,
              shapeType: event.target.value as NonNullable<
                ShapeElement["shapeType"]
              >,
            })
          }
          value={element.shapeType ?? "rectangle"}
        >
          <option value="line">Line</option>
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <NumberField
        label="Shape stroke width"
        min={0.1}
        shortLabel="STROKE"
        step={0.1}
        value={element.strokeWidthMm}
        onChange={(strokeWidthMm) =>
          onChange({ ...element, strokeWidthMm: Math.max(0.1, strokeWidthMm) })
        }
      />
      {(element.shapeType ?? "rectangle") !== "line" && (
        <label className="shape-fill-toggle">
          <input
            aria-label="Fill shape"
            checked={element.filled}
            onChange={(event) =>
              onChange({ ...element, filled: event.target.checked })
            }
            type="checkbox"
          />
          Filled
        </label>
      )}
      <FrameControls
        element={element}
        elementName="Shape"
        hasMultipleElements={hasMultipleElements}
        minSize={0.5}
        onChange={onChange}
        onMoveLayer={onMoveLayer}
      />
    </div>
  );
}

export function PlateToolbarSettings({
  plate,
  onChange,
  onTrim,
  onEnter = onTrim,
  showTrim = true,
}: {
  readonly plate: LabelPlate;
  readonly onChange: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
  readonly onEnter?: () => void;
  readonly showTrim?: boolean;
}) {
  return (
    <div className="plate-toolbar-settings">
      <label className="toolbar-field width-field">
        <span>WIDTH</span>
        <div className="toolbar-unit-input">
          <input
            aria-label="Plate width"
            inputMode="numeric"
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
              onEnter();
            }}
            step={1}
            type="number"
            value={plateEditorWidthMm(plate)}
          />
          <b>mm</b>
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
              inputMode="decimal"
              min={label === "Plate height" ? 1 : 0}
              onChange={(event) => {
                const next = Math.max(
                  label === "Plate height" ? 1 : 0,
                  Number(event.target.value),
                );
                if (label === "Plate height") {
                  onChange(updatePlateEditorHeight(plate, next));
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
                onEnter();
              }}
              type="number"
              value={Math.round((value as number) * 10) / 10}
            />
            <b>mm</b>
          </div>
        </label>
      ))}
      {showTrim && (
        <button
          aria-label="Trim plate to content"
          className="tool-button toolbar-trim-button"
          onClick={onTrim}
          title="Adjust the width to the printed content and margins"
          type="button"
        >
          <Crop size={15} /> Trim
        </button>
      )}
    </div>
  );
}

export interface InspectorContentProps {
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly selectedShape: ShapeElement | undefined;
  readonly hasMultipleElements: boolean;
  readonly onUpdateText: (element: TextElement) => void;
  readonly onUpdateImage: (element: ImageElement) => void;
  readonly onUpdateShape: (element: ShapeElement) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}

export function InspectorContent({
  selectedText,
  selectedImage,
  selectedShape,
  hasMultipleElements,
  onUpdateText,
  onUpdateImage,
  onUpdateShape,
  onMoveLayer,
}: InspectorContentProps) {
  return selectedText ? (
    <TextInspector
      element={selectedText}
      hasMultipleElements={hasMultipleElements}
      onChange={onUpdateText}
      onMoveLayer={onMoveLayer}
    />
  ) : selectedImage ? (
    <ImageInspector
      element={selectedImage}
      hasMultipleElements={hasMultipleElements}
      onChange={onUpdateImage}
      onMoveLayer={onMoveLayer}
    />
  ) : selectedShape ? (
    <ShapeInspector
      element={selectedShape}
      hasMultipleElements={hasMultipleElements}
      onChange={onUpdateShape}
      onMoveLayer={onMoveLayer}
    />
  ) : null;
}

export function Inspector({
  selectedText,
  selectedImage,
  selectedShape,
  hasMultipleElements,
  onDeleteSelection,
  onUpdateText,
  onUpdateImage,
  onUpdateShape,
  onMoveLayer,
}: InspectorContentProps & {
  readonly onDeleteSelection: () => void;
}) {
  const selectedElement = selectedText ?? selectedImage ?? selectedShape;
  return (
    <aside
      aria-hidden={selectedElement ? undefined : true}
      className={`inspector${selectedElement ? "" : " is-hidden"}`}
    >
      {selectedElement && (
        <div className="inspector-header">
          <span>
            {selectedText ? "Text" : selectedImage ? "Image" : "Shape"}
          </span>
          <div className="inspector-header-actions">
            <IconButton
              label="Delete selected element"
              onClick={onDeleteSelection}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        </div>
      )}
      <InspectorContent
        hasMultipleElements={hasMultipleElements}
        onMoveLayer={onMoveLayer}
        onUpdateImage={onUpdateImage}
        onUpdateShape={onUpdateShape}
        onUpdateText={onUpdateText}
        selectedImage={selectedImage}
        selectedShape={selectedShape}
        selectedText={selectedText}
      />
    </aside>
  );
}
