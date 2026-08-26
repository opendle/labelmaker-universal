import type { LabelPlate } from "@labelmaker/domain";
import { Bluetooth, Check, Printer, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { IconButton } from "./controls.js";
import type { PrinterSettings, PrinterSummary } from "./host.js";
import { LabelArtwork } from "./LabelArtwork.js";
import { displayMillimeters, nonPrintableMarginMm } from "./label-layout.js";
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
  readonly onAdd: (id: string) => boolean | Promise<boolean>;
}) {
  const [addingPrinterId, setAddingPrinterId] = useState<string | null>(null);
  const adding = addingPrinterId !== null;
  const handleAdd = async (printerId: string) => {
    if (adding) return;
    setAddingPrinterId(printerId);
    try {
      const added = await onAdd(printerId);
      if (added) onClose();
    } finally {
      setAddingPrinterId(null);
    }
  };
  const guardedClose = () => {
    if (!adding) onClose();
  };
  if (!open) return null;
  return (
    <Modal labelId="add-printer-title" onClose={guardedClose}>
      <div className="dialog-header">
        <div>
          <h2 id="add-printer-title">Add a printer</h2>
          <p>Nearby compatible printers</p>
        </div>
        <IconButton
          disabled={adding}
          initialFocus
          label="Close add printer"
          onClick={onClose}
        >
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
              disabled={adding}
              onClick={() => void handleAdd(printer.id)}
              type="button"
            >
              {addingPrinterId === printer.id ? (
                <>
                  <span aria-hidden="true" className="mini-spinner" />
                  Adding…
                </>
              ) : (
                "Add"
              )}
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
          disabled={discovering || adding}
          onClick={onSearch}
          type="button"
        >
          Search again
        </button>
      </div>
    </Modal>
  );
}

export function PrinterSettingsDialog({
  open,
  printer,
  labelHeightMm,
  onClose,
  onSave,
}: {
  readonly open: boolean;
  readonly printer: PrinterSummary | undefined;
  readonly labelHeightMm: number;
  readonly onClose: () => void;
  readonly onSave: (
    printerId: string,
    settings: PrinterSettings,
  ) => boolean | Promise<boolean>;
}) {
  if (!open || !printer) return null;
  return (
    <OpenPrinterSettingsDialog
      key={printer.id}
      labelHeightMm={labelHeightMm}
      onClose={onClose}
      onSave={onSave}
      printer={printer}
    />
  );
}

function OpenPrinterSettingsDialog({
  printer,
  labelHeightMm,
  onClose,
  onSave,
}: {
  readonly printer: PrinterSummary;
  readonly labelHeightMm: number;
  readonly onClose: () => void;
  readonly onSave: (
    printerId: string,
    settings: PrinterSettings,
  ) => boolean | Promise<boolean>;
}) {
  const [darkness, setDarkness] = useState(() => printer.darkness?.value ?? 0);
  const [saving, setSaving] = useState(false);
  const marginMm = nonPrintableMarginMm(
    labelHeightMm,
    printer.printableWidthMm,
  );
  const save = async () => {
    if (!printer.darkness || saving) return;
    setSaving(true);
    try {
      if (await onSave(printer.id, { darkness })) onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal labelId="printer-settings-title" onClose={onClose}>
      <div className="dialog-header">
        <div>
          <h2 id="printer-settings-title">Printer settings</h2>
          <p>
            {printer.name} · {printer.model}
          </p>
        </div>
        <IconButton
          disabled={saving}
          label="Close printer settings"
          onClick={onClose}
        >
          <X size={18} />
        </IconButton>
      </div>
      <div className="printer-settings-content">
        <div className="printer-settings-heading">
          <SlidersHorizontal size={18} />
          <div>
            <strong>Print output</strong>
            <span>Settings apply to this printer only.</span>
          </div>
        </div>
        <dl className="printer-capabilities">
          <div>
            <dt>Resolution</dt>
            <dd>
              {printer.dpi === undefined
                ? "Not reported"
                : `${printer.dpi} dpi`}
            </dd>
          </div>
          <div>
            <dt>Print head</dt>
            <dd>
              {printer.printableWidthMm === undefined
                ? "Not reported"
                : `${displayMillimeters(printer.printableWidthMm)} mm`}
            </dd>
          </div>
          <div>
            <dt>Current label</dt>
            <dd>{displayMillimeters(labelHeightMm)} mm</dd>
          </div>
          <div>
            <dt>Top and bottom margins</dt>
            <dd>{displayMillimeters(marginMm)} mm each</dd>
          </div>
        </dl>
        {printer.darkness ? (
          <label className="darkness-setting">
            <span>
              <strong>Darkness</strong>
              <output>{darkness}</output>
            </span>
            <input
              aria-label="Print darkness"
              disabled={saving}
              max={printer.darkness.maximum}
              min={printer.darkness.minimum}
              onChange={(event) => setDarkness(Number(event.target.value))}
              step={printer.darkness.step}
              type="range"
              value={darkness}
            />
            <small>
              {printer.darkness.minimum} lighter · {printer.darkness.maximum}{" "}
              darker
            </small>
          </label>
        ) : (
          <p className="printer-setting-unavailable">
            This printer does not report an adjustable darkness setting.
          </p>
        )}
      </div>
      <div className="dialog-footer end">
        <button
          className="button secondary"
          disabled={saving}
          onClick={onClose}
          type="button"
        >
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!printer.darkness || saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </Modal>
  );
}

function PreviewPlate({
  plate,
  verticalMarginMm,
}: {
  readonly plate: LabelPlate;
  readonly verticalMarginMm: number;
}) {
  return (
    <LabelArtwork
      className="preview-label"
      plate={plate}
      verticalMarginMm={verticalMarginMm}
    />
  );
}

export function PreviewDialog({
  open,
  plate,
  canPrint,
  onClose,
  onPrint,
  verticalMarginMm,
  printerDpi,
}: {
  readonly open: boolean;
  readonly plate: LabelPlate;
  readonly canPrint: boolean;
  readonly onClose: () => void;
  readonly onPrint: () => void;
  readonly verticalMarginMm: number;
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
        <div>
          <h2 id="preview-title">Print preview</h2>
          <p>{plate.name} · 1 label</p>
        </div>
        <IconButton initialFocus label="Close preview" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="preview-surface">
        <PreviewPlate plate={plate} verticalMarginMm={verticalMarginMm} />
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
        <button className="button secondary" onClick={onClose} type="button">
          Close preview
        </button>
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
