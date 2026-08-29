import type { LabelPlate } from "@labelmaker/domain";
import { Flag, FlipHorizontal2, Trash2, X } from "lucide-react";

import { IconButton } from "./controls.js";
import { isFlagPlate } from "./editor-operations.js";
import {
  InspectorContent,
  PlateToolbarSettings,
  type InspectorContentProps,
} from "./Inspector.js";
import { Modal } from "./Modal.js";

export function PhoneElementPropertySheet({
  selectedText,
  selectedImage,
  selectedShape,
  onClose,
  onDeleteSelection,
  ...contentProps
}: InspectorContentProps & {
  readonly onClose: () => void;
  readonly onDeleteSelection: () => void;
}) {
  const title = selectedText ? "Text" : selectedImage ? "Image" : "Shape";
  return (
    <Modal
      className="phone-property-modal"
      labelId="phone-element-properties-title"
      onClose={onClose}
    >
      <div className="phone-sheet-header">
        <h2 id="phone-element-properties-title">{title} properties</h2>
        <span className="phone-sheet-header-actions">
          <IconButton
            label="Delete selected element"
            onClick={() => {
              onDeleteSelection();
              onClose();
            }}
          >
            <Trash2 size={18} />
          </IconButton>
          <IconButton initialFocus label="Close properties" onClick={onClose}>
            <X size={19} />
          </IconButton>
        </span>
      </div>
      <InspectorContent
        {...contentProps}
        selectedImage={selectedImage}
        selectedShape={selectedShape}
        selectedText={selectedText}
      />
    </Modal>
  );
}

export function PhonePlatePropertySheet({
  plate,
  onChange,
  onClose,
  onToggleFlag,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly onChange: (plate: LabelPlate) => void;
  readonly onClose: () => void;
  readonly onToggleFlag: () => void;
  readonly onTrim: () => void;
}) {
  return (
    <Modal
      className="phone-property-modal phone-plate-property-modal"
      labelId="phone-plate-properties-title"
      onClose={onClose}
    >
      <div className="phone-sheet-header">
        <h2 id="phone-plate-properties-title">Label settings</h2>
        <IconButton initialFocus label="Close label settings" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="phone-plate-settings-content">
        <div className="phone-plate-mode-actions">
          <button
            aria-pressed={isFlagPlate(plate)}
            className={`tool-button${isFlagPlate(plate) ? " active" : ""}`}
            onClick={onToggleFlag}
            type="button"
          >
            <Flag size={17} /> Flag
          </button>
          <button
            aria-pressed={plate.mirrorPrint === true}
            className={`tool-button${plate.mirrorPrint ? " active" : ""}`}
            onClick={() =>
              onChange({ ...plate, mirrorPrint: !plate.mirrorPrint })
            }
            type="button"
          >
            <FlipHorizontal2 size={17} /> Mirror
          </button>
        </div>
        <PlateToolbarSettings
          onChange={onChange}
          onTrim={onTrim}
          plate={plate}
        />
      </div>
    </Modal>
  );
}
