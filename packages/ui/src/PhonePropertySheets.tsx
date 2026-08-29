import type { LabelPlate } from "@labelmaker/domain";
import { Flag, FlipHorizontal2, Trash2, X } from "lucide-react";

import { IconButton } from "./controls.js";
import {
  InspectorContent,
  PlateToolbarSettings,
  type InspectorContentProps,
} from "./Inspector.js";
import { Modal } from "./Modal.js";
import { isFlagPlate, toggleFlagPlate } from "./editor-operations.js";

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
  canDelete,
  draft,
  onChange,
  onClose,
  onDelete,
  onSave,
}: {
  readonly canDelete: boolean;
  readonly draft: LabelPlate;
  readonly onChange: (plate: LabelPlate) => void;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onSave: (plate: LabelPlate) => void;
}) {
  const save = () => {
    onSave(draft);
    onClose();
  };
  return (
    <Modal
      className="phone-property-modal phone-plate-property-modal"
      labelId="phone-plate-properties-title"
      onClose={onClose}
    >
      <form
        className="phone-plate-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="phone-sheet-header">
          <h2 id="phone-plate-properties-title">Label settings</h2>
          <IconButton
            initialFocus
            label="Close label settings"
            onClick={onClose}
          >
            <X size={19} />
          </IconButton>
        </div>
        <div className="phone-plate-settings-content">
          <PlateToolbarSettings
            onChange={onChange}
            onEnter={save}
            onTrim={() => undefined}
            plate={draft}
            showTrim={false}
          />
          <div
            aria-label="Special label settings"
            className="phone-special-settings"
          >
            <button
              aria-label="Flag"
              aria-pressed={isFlagPlate(draft)}
              className={`phone-special-toggle${isFlagPlate(draft) ? " active" : ""}`}
              onClick={() => onChange(toggleFlagPlate(draft))}
              type="button"
            >
              <Flag size={18} />
              <span>Flag</span>
            </button>
            <button
              aria-label="Mirror"
              aria-pressed={draft.mirrorPrint === true}
              className={`phone-special-toggle${draft.mirrorPrint ? " active" : ""}`}
              onClick={() =>
                onChange({ ...draft, mirrorPrint: !draft.mirrorPrint })
              }
              type="button"
            >
              <FlipHorizontal2 size={18} />
              <span>Mirror</span>
            </button>
          </div>
        </div>
        <div className="dialog-footer phone-plate-settings-footer">
          <button
            className="button phone-delete-label"
            disabled={!canDelete}
            onClick={() => {
              onDelete();
              onClose();
            }}
            title={
              canDelete
                ? `Delete ${draft.name}`
                : "A workspace must contain one label"
            }
            type="button"
          >
            <Trash2 size={16} /> Delete label
          </button>
          <button className="button primary" type="submit">
            Save settings
          </button>
        </div>
      </form>
    </Modal>
  );
}
