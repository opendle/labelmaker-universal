import type { LabelPlate } from "@labelmaker/domain";
import { Printer, X } from "lucide-react";

import { IconButton } from "./controls.js";
import { LabelArtwork } from "./LabelArtwork.js";
import type { PrintableMargins } from "./label-layout.js";
import { Modal } from "./Modal.js";

export function PreviewDialog({
  open,
  plate,
  canPrint,
  onClose,
  onPrint,
  printableMargins,
  printerDpi,
}: {
  readonly open: boolean;
  readonly plate: LabelPlate;
  readonly canPrint: boolean;
  readonly onClose: () => void;
  readonly onPrint: () => void;
  readonly printableMargins: PrintableMargins;
  readonly printerDpi: number | undefined;
}) {
  if (!open) return null;
  return (
    <Modal
      className="preview-backdrop"
      labelId="preview-title"
      onClose={onClose}
    >
      <div className="dialog-header">
        <h2 id="preview-title">Print preview</h2>
        <IconButton initialFocus label="Close preview" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="preview-surface">
        <LabelArtwork
          className="preview-label"
          mirrorArtwork={plate.mirrorPrint === true}
          plate={plate}
          printableMargins={printableMargins}
        />
      </div>
      <div className="preview-details">
        <span>
          <strong>Output</strong> Monochrome
          {printerDpi === undefined ? "" : ` · ${printerDpi} dpi`}
        </span>
        <span>
          <strong>Size</strong> {plate.size.widthMm} × {plate.size.heightMm} mm
        </span>
      </div>
      <div className="dialog-footer end">
        <button
          className="button primary"
          disabled={!canPrint}
          onClick={onPrint}
          type="button"
        >
          <Printer size={16} /> Print label
        </button>
      </div>
    </Modal>
  );
}
