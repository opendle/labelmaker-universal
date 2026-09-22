import type {
  CodeElement,
  LabelElement,
  ImageElement,
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
  Italic,
  RotateCcw,
  SendToBack,
  Sparkles,
  Trash2,
} from "lucide-react";
import { createContext, use, useId, useState } from "react";

import { IconButton } from "./controls.js";
import { TYPEFACES } from "./typefaces.js";
import { MonochromeImage } from "./MonochromeImage.js";
import { NumberInput } from "./NumberInput.js";
import {
  ROTATION_INPUT_STEP_DEGREES,
  snapRotationDegrees,
} from "./rotation.js";

const MixedFieldsContext = createContext<ReadonlySet<string>>(new Set());
function useMixed(field: string) {
  return use(MixedFieldsContext).has(field);
}
type PropertyChange<T> = (element: T, field: string) => void;

function NumberField({
  label,
  shortLabel,
  value,
  unit = "mm",
  min,
  icon,
  onChange,
  normalizeValue,
  step,
  integer = false,
  field = "",
}: {
  readonly label: string;
  readonly shortLabel: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly icon?: boolean;
  readonly onChange: (value: number) => void;
  readonly normalizeValue?: (value: number) => number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly field?: string;
}) {
  const inputId = useId();
  const mixed = useMixed(field);
  return (
    <label className="field" htmlFor={inputId}>
      <span>{shortLabel}</span>
      <div className="unit-input">
        {icon && <RotateCcw size={14} />}
        <NumberInput
          aria-label={label}
          id={inputId}
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          {...(normalizeValue ? { normalizeValue } : {})}
          onValueChange={(next) => {
            onChange(integer ? Math.round(next) : next);
          }}
          step={step}
          mixed={mixed}
          placeholder={mixed ? "Mixed" : undefined}
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
  readonly onChange: PropertyChange<TextElement>;
}) {
  const mixed = useMixed("lineHeightPt");
  const enabled = element.lineHeightPt !== undefined || mixed;
  const [emptyDraft, setEmptyDraft] = useState(false);
  const toggleAutomatic = () => {
    setEmptyDraft(false);
    if (enabled) {
      const { lineHeightPt: _lineHeightPt, ...automatic } = element;
      onChange(automatic, "lineHeightPt");
    } else {
      onChange(
        { ...element, lineHeightPt: element.fontSizePt },
        "lineHeightPt",
      );
    }
  };
  return (
    <div className="field line-height-field">
      <span>LINE HEIGHT</span>
      <div className="unit-input">
        <button
          aria-label="Use automatic line height"
          aria-pressed={mixed ? "mixed" : !enabled}
          className={`auto-line-height-toggle${enabled ? "" : " active"}`}
          onClick={toggleAutomatic}
          title="Automatic line height"
          type="button"
        >
          <Sparkles size={13} />
        </button>
        <input
          aria-label="Line height"
          placeholder={mixed ? "Mixed" : undefined}
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
            onChange(
              {
                ...element,
                lineHeightPt: Math.max(0.1, lineHeightPt),
              },
              "lineHeightPt",
            );
          }}
          step={0.1}
          type="number"
          value={
            emptyDraft || mixed
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

type FramedElement = TextElement | ImageElement | ShapeElement | CodeElement;

function FrameControls<T extends FramedElement>({
  element,
  elementName,
  positionName = elementName,
  minSize,
  hasMultipleElements,
  hideGeometry = false,
  onChange,
  onMoveLayer,
}: {
  readonly element: T;
  readonly elementName: string;
  readonly positionName?: string;
  readonly minSize: number;
  readonly hasMultipleElements: boolean;
  readonly hideGeometry?: boolean;
  readonly onChange: PropertyChange<T>;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  return (
    <>
      <div className="frame-geometry-controls" hidden={hideGeometry}>
        <div className="field-row">
          <NumberField
            field="widthMm"
            label={`${elementName} width`}
            min={minSize}
            shortLabel="WIDTH"
            step={0.1}
            value={element.widthMm}
            onChange={(widthMm) =>
              onChange(
                { ...element, widthMm: Math.max(minSize, widthMm) },
                "widthMm",
              )
            }
          />
          <NumberField
            field="heightMm"
            label={`${elementName} height`}
            min={minSize}
            shortLabel="HEIGHT"
            step={0.1}
            value={element.heightMm}
            onChange={(heightMm) =>
              onChange(
                { ...element, heightMm: Math.max(minSize, heightMm) },
                "heightMm",
              )
            }
          />
        </div>
        <div className="field-row position-row">
          <NumberField
            label={`${positionName ? `${positionName} ` : ""}X position`}
            field="xMm"
            shortLabel="X"
            step={0.1}
            value={element.xMm}
            onChange={(xMm) => onChange({ ...element, xMm }, "xMm")}
          />
          <NumberField
            label={`${positionName ? `${positionName} ` : ""}Y position`}
            field="yMm"
            shortLabel="Y"
            step={0.1}
            value={element.yMm}
            onChange={(yMm) => onChange({ ...element, yMm }, "yMm")}
          />
        </div>
        <NumberField
          icon
          field="rotationDeg"
          label={`${elementName} rotation`}
          normalizeValue={snapRotationDegrees}
          shortLabel="ROTATION"
          step={ROTATION_INPUT_STEP_DEGREES}
          unit="°"
          value={element.rotationDeg}
          onChange={(rotationDeg) =>
            onChange({ ...element, rotationDeg }, "rotationDeg")
          }
        />
      </div>
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
  readonly onChange: PropertyChange<TextElement>;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  const mixed = use(MixedFieldsContext);
  return (
    <div className="property-stack">
      <label className="field full">
        <span>TEXT</span>
        <textarea
          aria-label="Text value"
          placeholder={mixed.has("text") ? "Mixed" : undefined}
          value={mixed.has("text") ? "" : element.text}
          onChange={(event) =>
            onChange({ ...element, text: event.target.value }, "text")
          }
        />
      </label>
      <label className="field full">
        <span>TYPEFACE</span>
        <select
          aria-label="Typeface"
          className="typeface-select"
          onChange={(event) =>
            onChange(
              { ...element, fontFamily: event.target.value },
              "fontFamily",
            )
          }
          style={{ fontFamily: element.fontFamily }}
          value={mixed.has("fontFamily") ? "" : element.fontFamily}
        >
          {mixed.has("fontFamily") && <option value="">Mixed</option>}
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
          field="fontSizePt"
          label="Font size"
          min={1}
          shortLabel="SIZE"
          step={1}
          unit="pt"
          value={element.fontSizePt}
          onChange={(fontSizePt) =>
            onChange(
              { ...element, fontSizePt: Math.max(1, fontSizePt) },
              "fontSizePt",
            )
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
              aria-pressed={
                !mixed.has("fontWeight") && element.fontWeight === fontWeight
              }
              className={`weight-button weight-${fontWeight} ${!mixed.has("fontWeight") && element.fontWeight === fontWeight ? "active" : ""}`}
              key={fontWeight}
              onClick={() => onChange({ ...element, fontWeight }, "fontWeight")}
              style={{ fontWeight }}
              type="button"
            >
              B
            </button>
          ))}
        </span>
        <button
          aria-label="Italic"
          aria-pressed={
            mixed.has("fontStyle") ? "mixed" : element.fontStyle === "italic"
          }
          className={`italic-button ${!mixed.has("fontStyle") && element.fontStyle === "italic" ? "active" : ""}`}
          onClick={() =>
            onChange(
              {
                ...element,
                fontStyle: element.fontStyle === "italic" ? "normal" : "italic",
              },
              "fontStyle",
            )
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
                aria-pressed={!mixed.has("align") && element.align === align}
                className={
                  !mixed.has("align") && element.align === align ? "active" : ""
                }
                key={align}
                onClick={() => onChange({ ...element, align }, "align")}
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
                  !mixed.has("verticalAlign") &&
                  (element.verticalAlign ?? "middle") === verticalAlign
                }
                className={
                  !mixed.has("verticalAlign") &&
                  (element.verticalAlign ?? "middle") === verticalAlign
                    ? "active"
                    : ""
                }
                key={verticalAlign}
                onClick={() =>
                  onChange({ ...element, verticalAlign }, "verticalAlign")
                }
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
        hideGeometry
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
  readonly onChange: PropertyChange<ImageElement>;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  const mixed = use(MixedFieldsContext);
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
              onChange(
                {
                  ...element,
                  fit: event.target.value as ImageElement["fit"],
                },
                "fit",
              )
            }
            value={mixed.has("fit") ? "" : element.fit}
          >
            {mixed.has("fit") && <option value="">Mixed</option>}
            <option value="contain">Contain</option>
            <option value="cover">Cover</option>
            <option value="stretch">Stretch</option>
          </select>
        </label>
        <button
          aria-label="Transparent image background"
          aria-pressed={
            mixed.has("transparentBackground")
              ? "mixed"
              : element.transparentBackground !== false
          }
          className={`image-background-toggle${element.transparentBackground !== false ? " active" : ""}`}
          onClick={() =>
            onChange(
              {
                ...element,
                transparentBackground: element.transparentBackground === false,
              },
              "transparentBackground",
            )
          }
          type="button"
        >
          Transparent
        </button>
      </div>
      <label className="field image-tone-field">
        <span>
          BRIGHTNESS{" "}
          <b>{mixed.has("brightness") ? "Mixed" : element.brightness}</b>
        </span>
        <input
          aria-label="Image brightness"
          max={255}
          min={0}
          onChange={(event) =>
            onChange(
              { ...element, brightness: Number(event.target.value) },
              "brightness",
            )
          }
          type="range"
          value={element.brightness}
        />
      </label>
      <label className="field image-tone-field">
        <span>
          CONTRAST <b>{mixed.has("contrast") ? "Mixed" : element.contrast}</b>
        </span>
        <input
          aria-label="Image contrast"
          max={255}
          min={0}
          onChange={(event) =>
            onChange(
              { ...element, contrast: Number(event.target.value) },
              "contrast",
            )
          }
          type="range"
          value={element.contrast}
        />
      </label>
      <FrameControls
        element={element}
        elementName="Image"
        hasMultipleElements={hasMultipleElements}
        hideGeometry
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
  readonly onChange: PropertyChange<ShapeElement>;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}) {
  const mixed = use(MixedFieldsContext);
  return (
    <div className="property-stack">
      <label className="field full">
        <span>SHAPE</span>
        <select
          aria-label="Shape type"
          onChange={(event) =>
            onChange(
              {
                ...element,
                shapeType: event.target.value as NonNullable<
                  ShapeElement["shapeType"]
                >,
              },
              "shapeType",
            )
          }
          value={
            mixed.has("shapeType") ? "" : (element.shapeType ?? "rectangle")
          }
        >
          {mixed.has("shapeType") && <option value="">Mixed</option>}
          <option value="line">Line</option>
          <option value="rectangle">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <NumberField
        field="strokeWidthMm"
        label="Shape stroke width"
        min={0.1}
        shortLabel="STROKE"
        step={0.1}
        value={element.strokeWidthMm}
        onChange={(strokeWidthMm) =>
          onChange(
            { ...element, strokeWidthMm: Math.max(0.1, strokeWidthMm) },
            "strokeWidthMm",
          )
        }
      />
      {(element.shapeType ?? "rectangle") !== "line" && (
        <label className="shape-fill-toggle">
          <input
            aria-label="Fill shape"
            aria-checked={mixed.has("filled") ? "mixed" : element.filled}
            checked={!mixed.has("filled") && element.filled}
            onChange={(event) =>
              onChange({ ...element, filled: event.target.checked }, "filled")
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

export interface InspectorContentProps {
  readonly selectedElements?: readonly LabelElement[];
  readonly onUpdateSelection?: (
    element: LabelElement,
    fields: readonly string[],
  ) => void;
  readonly selectedCode?: CodeElement | undefined;
  readonly onUpdateCode?: ((element: CodeElement) => void) | undefined;
  readonly onEditCode?: ((element: CodeElement) => void) | undefined;
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly selectedShape: ShapeElement | undefined;
  readonly hasMultipleElements: boolean;
  readonly onUpdateText: (element: TextElement) => void;
  readonly onUpdateImage: (element: ImageElement) => void;
  readonly onUpdateShape: (element: ShapeElement) => void;
  readonly onMoveLayer: (direction: "back" | "front") => void;
}

function ElementInspectorContent({
  selectedElements,
  onUpdateSelection,
  selectedCode,
  onUpdateCode,
  onEditCode,
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
      onChange={(element, field) =>
        selectedElements && selectedElements.length > 1
          ? onUpdateSelection?.(element, [field])
          : onUpdateText(element)
      }
      onMoveLayer={onMoveLayer}
    />
  ) : selectedImage ? (
    <ImageInspector
      element={selectedImage}
      hasMultipleElements={hasMultipleElements}
      onChange={(element, field) =>
        selectedElements && selectedElements.length > 1
          ? onUpdateSelection?.(element, [field])
          : onUpdateImage(element)
      }
      onMoveLayer={onMoveLayer}
    />
  ) : selectedShape ? (
    <ShapeInspector
      element={selectedShape}
      hasMultipleElements={hasMultipleElements}
      onChange={(element, field) =>
        selectedElements && selectedElements.length > 1
          ? onUpdateSelection?.(element, [field])
          : onUpdateShape(element)
      }
      onMoveLayer={onMoveLayer}
    />
  ) : selectedCode ? (
    <div className="property-stack">
      <button
        className="button"
        type="button"
        onClick={() => onEditCode?.(selectedCode)}
      >
        Edit code
      </button>
      <FrameControls
        element={selectedCode}
        elementName="Code"
        minSize={1}
        hasMultipleElements={hasMultipleElements}
        onChange={(element, field) =>
          selectedElements && selectedElements.length > 1
            ? onUpdateSelection?.(element, [field])
            : onUpdateCode?.(element)
        }
        onMoveLayer={onMoveLayer}
      />
    </div>
  ) : null;
}

export function InspectorContent(props: InspectorContentProps) {
  const elements = props.selectedElements ?? [];
  const keys = new Set(elements.flatMap((element) => Object.keys(element)));
  const mixed = new Set(
    [...keys].filter((key) =>
      elements.some(
        (element) =>
          JSON.stringify(
            (element as unknown as Record<string, unknown>)[key],
          ) !==
          JSON.stringify(
            (elements[0] as unknown as Record<string, unknown>)[key],
          ),
      ),
    ),
  );
  return (
    <MixedFieldsContext value={mixed}>
      <ElementInspectorContent {...props} />
    </MixedFieldsContext>
  );
}

export function Inspector({
  selectedElements,
  onUpdateSelection,
  selectedCode,
  onUpdateCode,
  onEditCode,
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
  const selectedElement =
    selectedText ?? selectedImage ?? selectedShape ?? selectedCode;
  return (
    <aside
      aria-hidden={selectedElement ? undefined : true}
      className={`inspector${selectedElement ? "" : " is-hidden"}`}
    >
      {selectedElement && (
        <div className="inspector-header">
          <span>
            {selectedText
              ? "Text"
              : selectedImage
                ? "Image"
                : selectedShape
                  ? "Shape"
                  : selectedCode?.kind === "qr"
                    ? "QR code"
                    : "Barcode"}
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
        {...(selectedElements ? { selectedElements } : {})}
        {...(onUpdateSelection ? { onUpdateSelection } : {})}
        selectedCode={selectedCode}
        onUpdateCode={onUpdateCode}
        onEditCode={onEditCode}
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
