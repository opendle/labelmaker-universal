import {
  Check,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  Plus,
  Printer,
  Save,
  Settings,
} from "lucide-react";

import { IconButton } from "./controls.js";
import type { PrinterSummary } from "./host.js";

function StatusDot({ state }: { readonly state: PrinterSummary["state"] }) {
  return <span aria-label={state} className={`status-dot status-${state}`} />;
}

export function LeftRail({
  printers,
  activePrinterId,
  onSelectPrinter,
  onAddPrinter,
  onNew,
  onOpen,
  onSaveAs,
}: {
  readonly printers: readonly PrinterSummary[];
  readonly activePrinterId: string;
  readonly onSelectPrinter: (id: string) => void;
  readonly onAddPrinter: () => void;
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onSaveAs: () => void;
}) {
  return (
    <aside className="left-rail">
      <section className="rail-section printers-section">
        <div className="section-heading">
          <span>PRINTERS</span>
          <IconButton label="Printer settings">
            <Settings size={15} />
          </IconButton>
        </div>
        <div className="printer-list">
          {printers.map((printer) => (
            <button
              className={`printer-item ${printer.id === activePrinterId ? "selected" : ""}`}
              key={printer.id}
              onClick={() => onSelectPrinter(printer.id)}
              type="button"
            >
              <span className="printer-icon">
                <Printer size={19} />
              </span>
              <span className="printer-copy">
                <strong>{printer.name}</strong>
                <small>
                  <StatusDot state={printer.state} /> {printer.statusMessage}
                </small>
              </span>
              {printer.id === activePrinterId && (
                <Check className="selected-check" size={16} />
              )}
            </button>
          ))}
        </div>
        <button className="add-printer" onClick={onAddPrinter} type="button">
          <Plus size={16} /> Add printer
        </button>
      </section>
      <section className="rail-section workspace-section">
        <div className="section-heading">
          <span>WORKSPACE</span>
        </div>
        <button className="rail-action" onClick={onNew} type="button">
          <FilePlus2 size={17} /> New workspace
        </button>
        <button className="rail-action" onClick={onOpen} type="button">
          <FolderOpen size={17} /> Open workspace…
        </button>
        <button className="rail-action" onClick={onSaveAs} type="button">
          <Save size={17} /> Save workspace as…
        </button>
      </section>
      <div className="rail-footer">
        <CircleHelp size={16} /> Help & shortcuts
      </div>
    </aside>
  );
}
