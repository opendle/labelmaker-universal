import {
  Check,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  Plus,
  Printer,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "./controls.js";
import type { HostPlatform, PrinterSummary } from "./host.js";

function StatusDot({ state }: { readonly state: PrinterSummary["state"] }) {
  return <span aria-label={state} className={`status-dot status-${state}`} />;
}

export function AppHeader({
  workspaceName,
  plateCount,
  saveState,
  printers,
  activePrinterId,
  canUndo,
  canRedo,
  canPrint,
  printMenuOpen,
  onNew,
  onOpen,
  onSave,
  onSelectPrinter,
  onAddPrinter,
  onRemovePrinter,
  onUndo,
  onRedo,
  onPreview,
  onPrint,
  onPrintMenuChange,
  platform,
}: {
  readonly workspaceName: string;
  readonly plateCount: number;
  readonly saveState: string;
  readonly printers: readonly PrinterSummary[];
  readonly activePrinterId: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPrint: boolean;
  readonly printMenuOpen: boolean;
  readonly onNew: () => void;
  readonly onOpen: () => void;
  readonly onSave: () => void;
  readonly onSelectPrinter: (printerId: string) => void;
  readonly onAddPrinter: () => void;
  readonly onRemovePrinter?: (printerId: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onPreview: () => void;
  readonly onPrint: (all: boolean) => void;
  readonly onPrintMenuChange: (open: boolean) => void;
  readonly platform: HostPlatform;
}) {
  const activePrinter = printers.find(
    (printer) => printer.id === activePrinterId,
  );
  const [printerMenuOpen, setPrinterMenuOpen] = useState(false);
  const printControlRef = useRef<HTMLDivElement>(null);
  const printerControlRef = useRef<HTMLDivElement>(null);
  const printMenuRef = useRef<HTMLDivElement>(null);
  const onPrintMenuChangeRef = useRef(onPrintMenuChange);

  useEffect(() => {
    onPrintMenuChangeRef.current = onPrintMenuChange;
  }, [onPrintMenuChange]);

  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!printControlRef.current?.contains(target))
        onPrintMenuChangeRef.current(false);
      if (!printerControlRef.current?.contains(target))
        setPrinterMenuOpen(false);
    };
    globalThis.document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        onDocumentPointerDown,
      );
  }, []);

  const onPrintMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ),
    );
    const index = items.indexOf(
      globalThis.document.activeElement as HTMLButtonElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      onPrintMenuChange(false);
      printControlRef.current
        ?.querySelector<HTMLButtonElement>(".split")
        ?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  };

  return (
    <header className="titlebar">
      <div className="header-leading">
        <div
          aria-hidden="true"
          className={`window-drag-spacer ${platform === "macos" ? "macos" : ""}`}
        />
        <nav aria-label="Workspace actions" className="workspace-actions">
          <button className="header-action" onClick={onNew} type="button">
            <FilePlus2 size={19} />
            <span>New</span>
          </button>
          <button className="header-action" onClick={onOpen} type="button">
            <FolderOpen size={19} />
            <span>Open</span>
          </button>
          <button className="header-action" onClick={onSave} type="button">
            <Save size={19} />
            <span>Save</span>
          </button>
        </nav>
      </div>
      <div className="document-identity">
        <span className="document-name">{workspaceName}</span>
        <span
          className={`save-state ${saveState === "Edited" ? "is-dirty" : ""}`}
        >
          {saveState}
        </span>
      </div>
      <div className="title-actions">
        <div className="toolbar-cluster">
          <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={17} />
          </IconButton>
        </div>
        <div className="printer-picker" ref={printerControlRef}>
          <button
            aria-label={
              activePrinter
                ? `Selected printer: ${activePrinter.name}`
                : "Choose printer"
            }
            aria-expanded={printerMenuOpen}
            aria-haspopup="menu"
            className="printer-trigger"
            onClick={() => setPrinterMenuOpen((open) => !open)}
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
          {printerMenuOpen && (
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
                      setPrinterMenuOpen(false);
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
            </div>
          )}
        </div>
        <IconButton label="Add printer" onClick={onAddPrinter}>
          <Plus size={18} />
        </IconButton>
        <button className="button secondary" onClick={onPreview} type="button">
          <ImageIcon size={16} /> Preview
        </button>
        <div className="print-control" ref={printControlRef}>
          <button
            className="button primary"
            disabled={!canPrint}
            onClick={() => onPrint(false)}
            type="button"
          >
            <Printer size={16} /> Print
          </button>
          <button
            aria-expanded={printMenuOpen}
            aria-haspopup="menu"
            aria-label="Print options"
            className="button primary split"
            disabled={!canPrint}
            onClick={() => {
              const nextOpen = !printMenuOpen;
              onPrintMenuChange(nextOpen);
              if (nextOpen) {
                globalThis.requestAnimationFrame(() =>
                  printMenuRef.current
                    ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
                    ?.focus(),
                );
              }
            }}
            type="button"
          >
            <ChevronDown size={15} />
          </button>
          {printMenuOpen && (
            <div
              aria-label="Print options"
              className="popup-menu"
              onKeyDown={onPrintMenuKeyDown}
              ref={printMenuRef}
              role="menu"
              tabIndex={-1}
            >
              <button
                onClick={() => onPrint(false)}
                role="menuitem"
                type="button"
              >
                Print current label
              </button>
              <button
                onClick={() => onPrint(true)}
                role="menuitem"
                type="button"
              >
                Print all {plateCount} labels
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
