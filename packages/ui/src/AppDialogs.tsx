import type { LabelPlate } from "@labelmaker/domain";
import { Bluetooth, Check, Printer, X } from "lucide-react";
import type { CSSProperties } from "react";

import { IconButton } from "./controls.js";
import type { PrinterSummary } from "./host.js";
import { Modal } from "./Modal.js";

export function AddPrinterDialog({
  open,
  discovering,
  discovered,
  onClose,
  onSearch,
  onAdd,
}: {
  readonly open: boolean;
  readonly discovering: boolean;
  readonly discovered: readonly PrinterSummary[];
  readonly onClose: () => void;
  readonly onSearch: () => void;
  readonly onAdd: (id: string) => void;
}) {
  if (!open) return null;
  return (
    <Modal labelId="add-printer-title" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <h2 id="add-printer-title">Add a printer</h2>
          <p>Nearby compatible printers</p>
        </div>
        <IconButton initialFocus label="Close add printer" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="discovery-banner">
        <Bluetooth size={18} />
        <div>
          <strong>
            {discovering
              ? "Looking for printers…"
              : `${discovered.length} ${discovered.length === 1 ? "printer" : "printers"} found`}
          </strong>
          <span>Bluetooth is on. Keep your printer nearby.</span>
        </div>
        <span className={discovering ? "spinner" : "discovery-check"}>
          {discovering ? "" : <Check size={16} />}
        </span>
      </div>
      <div className="discovery-list">
        {discovered.map((printer) => (
          <div className="discovery-item" key={printer.id}>
            <span className="printer-icon">
              <Printer size={20} />
            </span>
            <div>
              <strong>{printer.name}</strong>
              <span>
                {printer.model} · {printer.statusMessage}
              </span>
            </div>
            <button
              className="button primary small"
              onClick={() => onAdd(printer.id)}
              type="button"
            >
              Add
            </button>
          </div>
        ))}
        {discovering && (
          <>
            <div className="discovery-skeleton" />
            <div className="discovery-skeleton short" />
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button
          className="button secondary"
          disabled={discovering}
          onClick={onSearch}
          type="button"
        >
          Search again
        </button>
        <button className="text-button" type="button">
          My printer is not listed
        </button>
      </div>
    </Modal>
  );
}

function PreviewPlate({ plate }: { readonly plate: LabelPlate }) {
  type PreviewStyle = CSSProperties & Record<`--${string}`, string | number>;
  return (
    <div
      className="preview-label"
      style={
        {
          "--preview-aspect-ratio": `${plate.size.widthMm}/${plate.size.heightMm}`,
        } as PreviewStyle
      }
    >
      {plate.elements.map((item) => {
        const style: PreviewStyle = {
          "--preview-left": `${(item.xMm / plate.size.widthMm) * 100}%`,
          "--preview-top": `${(item.yMm / plate.size.heightMm) * 100}%`,
          "--preview-width": `${(item.widthMm / plate.size.widthMm) * 100}%`,
          "--preview-height": `${(item.heightMm / plate.size.heightMm) * 100}%`,
          "--preview-rotation": `rotate(${item.rotationDeg}deg)`,
        };
        if (item.kind === "image")
          return (
            <img
              alt=""
              className={`fit-${item.fit}`}
              key={item.id}
              src={item.source}
              style={style}
            />
          );
        if (item.kind === "rectangle")
          return (
            <i
              key={item.id}
              style={
                {
                  ...style,
                  "--preview-shape-background": item.filled
                    ? "#222"
                    : "transparent",
                  "--preview-shape-border": item.filled
                    ? "0"
                    : `${item.strokeWidthMm}px solid #222`,
                } as PreviewStyle
              }
            />
          );
        if (item.kind !== "text") return null;
        return (
          <span
            className={`preview-text align-${item.align}`}
            key={item.id}
            style={
              {
                ...style,
                "--preview-font-family": item.fontFamily,
                "--preview-font-size": `${item.fontSizePt}px`,
                "--preview-font-style": item.fontStyle ?? "normal",
                "--preview-font-weight": item.fontWeight,
              } as PreviewStyle
            }
          >
            {item.text}
          </span>
        );
      })}
    </div>
  );
}

export function PreviewDialog({
  open,
  plate,
  canPrint,
  onClose,
  onPrint,
}: {
  readonly open: boolean;
  readonly plate: LabelPlate;
  readonly canPrint: boolean;
  readonly onClose: () => void;
  readonly onPrint: () => void;
}) {
  if (!open) return null;
  return (
    <Modal
      className="preview-backdrop"
      labelId="preview-title"
      onClose={onClose}
    >
      <div className="dialog-header">
        <div>
          <h2 id="preview-title">Print preview</h2>
          <p>{plate.name} · 1 plate</p>
        </div>
        <IconButton initialFocus label="Close preview" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="preview-surface">
        <PreviewPlate plate={plate} />
      </div>
      <div className="preview-details">
        <span>
          <strong>Output</strong> Monochrome · 203 dpi
        </span>
        <span>
          <strong>Size</strong> {plate.size.widthMm} × {plate.size.heightMm} mm
        </span>
      </div>
      <div className="dialog-footer end">
        <button className="button secondary" onClick={onClose} type="button">
          Close preview
        </button>
        <button
          className="button primary"
          disabled={!canPrint}
          onClick={onPrint}
          type="button"
        >
          <Printer size={16} /> Print plate
        </button>
      </div>
    </Modal>
  );
}
