import { FilePlus2, FolderOpen, Files, Redo2, Save, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AppHeaderProps } from "./AppHeader.js";
import { AppHeaderPrinterPicker } from "./AppHeaderPrinterPicker.js";
import { AppHeaderPrintControl } from "./AppHeaderPrintControl.js";
import { IconButton } from "./controls.js";

export function PhoneHeader({
  workspaceName,
  saveState,
  printers,
  activePrinterId,
  canUndo,
  canRedo,
  canPrint,
  printMenuOpen,
  plateCount,
  onNew,
  onOpen,
  onSave,
  onSelectPrinter,
  onAddPrinter,
  onRemovePrinter,
  onOpenPrinterSettings,
  onUndo,
  onRedo,
  onPreview,
  onPrint,
  onPrintMenuChange,
  platform,
}: AppHeaderProps) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceControlRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const onPrintMenuChangeRef = useRef(onPrintMenuChange);

  useEffect(() => {
    onPrintMenuChangeRef.current = onPrintMenuChange;
  }, [onPrintMenuChange]);

  useEffect(
    () => () => {
      onPrintMenuChangeRef.current(false);
    },
    [],
  );

  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (!workspaceControlRef.current?.contains(event.target as Node)) {
        setWorkspaceMenuOpen(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", closeMenu);
    return () =>
      globalThis.document.removeEventListener("pointerdown", closeMenu);
  }, []);

  const runWorkspaceAction = (action: () => void) => {
    setWorkspaceMenuOpen(false);
    action();
  };

  return (
    <header className="phone-titlebar">
      <div
        aria-hidden="true"
        className={`phone-window-drag-spacer ${platform === "macos" ? "macos" : ""}`}
      />
      <div className="phone-header-actions">
        <div className="phone-workspace-control" ref={workspaceControlRef}>
          <button
            aria-expanded={workspaceMenuOpen}
            aria-haspopup="menu"
            aria-label={`Workspace ${workspaceName}, ${saveState}`}
            className={`phone-header-icon${saveState === "Edited" ? " is-dirty" : ""}`}
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
            ref={workspaceTriggerRef}
            type="button"
          >
            <Files size={19} />
          </button>
          {workspaceMenuOpen && (
            <div
              aria-label="Workspace actions"
              className="phone-workspace-menu"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setWorkspaceMenuOpen(false);
                workspaceTriggerRef.current?.focus();
              }}
              role="menu"
              tabIndex={-1}
            >
              <div className="phone-workspace-summary">
                <strong>{workspaceName}</strong>
                <span>{saveState}</span>
              </div>
              <button
                onClick={() => runWorkspaceAction(onNew)}
                role="menuitem"
                type="button"
              >
                <FilePlus2 size={17} /> New workspace
              </button>
              <button
                onClick={() => runWorkspaceAction(onOpen)}
                role="menuitem"
                type="button"
              >
                <FolderOpen size={17} /> Open workspace
              </button>
              <button
                onClick={() => runWorkspaceAction(onSave)}
                role="menuitem"
                type="button"
              >
                <Save size={17} /> Save workspace
              </button>
            </div>
          )}
        </div>
        <IconButton label="Save" onClick={onSave}>
          <Save size={18} />
        </IconButton>
        <span className="phone-history-actions">
          <IconButton label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={18} />
          </IconButton>
          <IconButton label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={18} />
          </IconButton>
        </span>
        <AppHeaderPrinterPicker
          activePrinterId={activePrinterId}
          compactStatus
          onAddPrinter={onAddPrinter}
          onOpenPrinterSettings={onOpenPrinterSettings}
          onRemovePrinter={onRemovePrinter}
          onSelectPrinter={onSelectPrinter}
          printers={printers}
        />
        <AppHeaderPrintControl
          canPrint={canPrint}
          menuOpen={printMenuOpen}
          onMenuChange={onPrintMenuChange}
          onPreview={() => {
            onPrintMenuChange(false);
            onPreview();
          }}
          onPrint={(all) => {
            onPrintMenuChange(false);
            onPrint(all);
          }}
          plateCount={plateCount}
        />
      </div>
    </header>
  );
}
