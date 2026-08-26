import {
  Check,
  ChevronDown,
  Plus,
  Printer,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "./controls.js";
import type { PrinterSummary } from "./host.js";

function StatusDot({ state }: { readonly state: PrinterSummary["state"] }) {
  return <span aria-label={state} className={`status-dot status-${state}`} />;
}

export function AppHeaderPrinterPicker({
  printers,
  activePrinterId,
  onSelectPrinter,
  onAddPrinter,
  onRemovePrinter,
  onOpenPrinterSettings,
}: {
  readonly printers: readonly PrinterSummary[];
  readonly activePrinterId: string;
  readonly onSelectPrinter: (printerId: string) => void;
  readonly onAddPrinter: () => void;
  readonly onRemovePrinter: ((printerId: string) => void) | undefined;
  readonly onOpenPrinterSettings: (printerId: string) => void;
}) {
  const activePrinter = printers.find(
    (printer) => printer.id === activePrinterId,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        onDocumentPointerDown,
      );
  }, []);

  if (printers.length === 0) {
    return (
      <button
        className="printer-trigger printer-add-trigger"
        onClick={onAddPrinter}
        type="button"
      >
        <Plus size={17} />
        <strong>Add printer</strong>
      </button>
    );
  }

  return (
    <div className="printer-picker" ref={controlRef}>
      <button
        aria-label={
          activePrinter
            ? `Selected printer: ${activePrinter.name}`
            : "Choose printer"
        }
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="printer-trigger"
        onClick={() => setMenuOpen((open) => !open)}
        ref={triggerRef}
        type="button"
      >
        <Printer size={17} />
        <span className="printer-trigger-copy">
          <strong>{activePrinter?.name ?? "No printer"}</strong>
          <small>
            {activePrinter ? (
              <>
                <StatusDot state={activePrinter.state} />
                {activePrinter.statusMessage}
              </>
            ) : (
              "Select a printer"
            )}
          </small>
        </span>
        <ChevronDown size={15} />
      </button>
      {menuOpen && (
        <div aria-label="Printers" className="printer-menu" role="menu">
          {printers.length === 0 && (
            <p className="printer-menu-empty">No printers added</p>
          )}
          {printers.map((printer) => (
            <div className="header-printer-row" key={printer.id}>
              <button
                aria-checked={printer.id === activePrinterId}
                className="header-printer-option"
                onClick={() => {
                  onSelectPrinter(printer.id);
                  setMenuOpen(false);
                }}
                role="menuitemradio"
                type="button"
              >
                <span className="printer-icon">
                  <Printer size={18} />
                </span>
                <span className="printer-copy">
                  <strong>{printer.name}</strong>
                  <small>
                    <StatusDot state={printer.state} />
                    {printer.statusMessage}
                  </small>
                </span>
                {printer.id === activePrinterId && <Check size={16} />}
              </button>
              <IconButton
                label={`Settings for ${printer.name}`}
                onClick={() => {
                  onOpenPrinterSettings(printer.id);
                  setMenuOpen(false);
                }}
              >
                <Settings size={14} />
              </IconButton>
              {onRemovePrinter && (
                <IconButton
                  label={`Remove ${printer.name}`}
                  onClick={() => onRemovePrinter(printer.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              )}
            </div>
          ))}
          <button
            className="printer-menu-add"
            onClick={() => {
              setMenuOpen(false);
              triggerRef.current?.focus();
              onAddPrinter();
            }}
            role="menuitem"
            type="button"
          >
            + Add a printer
          </button>
        </div>
      )}
    </div>
  );
}
