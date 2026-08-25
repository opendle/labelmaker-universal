import type { ImageElement, LabelPlate, TextElement } from "@labelmaker/domain";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Crop,
  RotateCcw,
  Settings,
  X,
} from "lucide-react";

import { IconButton } from "./controls.js";

function NumberField({
  label,
  shortLabel,
  value,
  unit = "mm",
  min,
  icon,
  onChange,
}: {
  readonly label: string;
  readonly shortLabel: string;
  readonly value: number;
  readonly unit?: string;
  readonly min?: number;
  readonly icon?: boolean;
  readonly onChange: (value: number) => void;
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
          type="number"
          value={Math.round(value * 10) / 10}
        />
        <b>{unit}</b>
      </div>
    </label>
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
        <span>CONTENT</span>
        <textarea
          aria-label="Text content"
          onChange={(event) =>
            onChange({ ...element, text: event.target.value })
          }
          value={element.text}
        />
      </label>
      <label className="field full">
        <span>TYPEFACE</span>
        <select
          aria-label="Typeface"
          onChange={(event) =>
            onChange({ ...element, fontFamily: event.target.value })
          }
          value={element.fontFamily}
        >
          <option>Inter</option>
          <option>Arial</option>
          <option>Georgia</option>
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
        <label className="field">
          <span>WEIGHT</span>
          <select
            aria-label="Font weight"
            onChange={(event) =>
              onChange({ ...element, fontWeight: Number(event.target.value) })
            }
            value={element.fontWeight}
          >
            <option value="400">Regular</option>
            <option value="600">Semi bold</option>
            <option value="700">Bold</option>
          </select>
        </label>
      </div>
      <div className="property-label">ALIGNMENT</div>
      <div className="segmented">
        {(["left", "center", "right"] as const).map((align) => (
          <button
            aria-label={`Align ${align}`}
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
      <div className="property-label">POSITION</div>
      <div className="field-row">
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

function PlateInspector({
  plate,
  onChange,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly onChange: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
}) {
  return (
    <div className="property-stack">
      <div className="inspector-note">
        Plate settings apply only to this label.
      </div>
      <label className="field full">
        <span>PLATE NAME</span>
        <input
          aria-label="Plate name"
          onChange={(event) => onChange({ ...plate, name: event.target.value })}
          value={plate.name}
        />
      </label>
      <div className="plate-size-row">
        <NumberField
          label="Plate width"
          min={1}
          shortLabel="WIDTH"
          value={plate.size.widthMm}
          onChange={(widthMm) =>
            onChange({
              ...plate,
              size: { ...plate.size, widthMm: Math.max(1, widthMm) },
            })
          }
        />
        <NumberField
          label="Plate height"
          min={1}
          shortLabel="HEIGHT"
          value={plate.size.heightMm}
          onChange={(heightMm) =>
            onChange({
              ...plate,
              size: { ...plate.size, heightMm: Math.max(1, heightMm) },
            })
          }
        />
        <button
          aria-label="Trim plate to content"
          className="trim-button"
          onClick={onTrim}
          title="Trim width to content and margins"
          type="button"
        >
          <Crop size={16} />
        </button>
      </div>
      <fieldset className="margin-fieldset">
        <legend>MARGINS</legend>
        <div className="field-row">
          <NumberField
            label="Left margin"
            min={0}
            shortLabel="LEFT"
            value={plate.margins.leftMm}
            onChange={(leftMm) =>
              onChange({
                ...plate,
                margins: { ...plate.margins, leftMm: Math.max(0, leftMm) },
              })
            }
          />
          <NumberField
            label="Right margin"
            min={0}
            shortLabel="RIGHT"
            value={plate.margins.rightMm}
            onChange={(rightMm) =>
              onChange({
                ...plate,
                margins: { ...plate.margins, rightMm: Math.max(0, rightMm) },
              })
            }
          />
        </div>
      </fieldset>
    </div>
  );
}

export function Inspector({
  plate,
  selectedText,
  selectedImage,
  onClearSelection,
  onUpdateText,
  onUpdateImage,
  onUpdatePlate,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly onClearSelection: () => void;
  readonly onUpdateText: (element: TextElement) => void;
  readonly onUpdateImage: (element: ImageElement) => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
}) {
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <span>{selectedText ? "Text" : selectedImage ? "Image" : "Plate"}</span>
        {(selectedText || selectedImage) && (
          <IconButton label="Clear selection" onClick={onClearSelection}>
            <X size={15} />
          </IconButton>
        )}
      </div>
      {selectedText ? (
        <TextInspector element={selectedText} onChange={onUpdateText} />
      ) : selectedImage ? (
        <ImageInspector element={selectedImage} onChange={onUpdateImage} />
      ) : (
        <PlateInspector
          onChange={onUpdatePlate}
          onTrim={onTrim}
          plate={plate}
        />
      )}
      <div className="inspector-plate-settings">
        <button onClick={onClearSelection} type="button">
          <Settings size={15} /> Plate settings
        </button>
      </div>
    </aside>
  );
}
