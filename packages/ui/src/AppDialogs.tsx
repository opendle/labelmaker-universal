import { Bluetooth, Check, Printer, X } from "lucide-react";
import { useState } from "react";

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
