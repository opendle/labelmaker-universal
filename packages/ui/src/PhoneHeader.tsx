import { FilePlus2, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { AppHeaderProps } from "./AppHeader.js";
import { AppHeaderPrinterPicker } from "./AppHeaderPrinterPicker.js";
import { AppHeaderPrintControl } from "./AppHeaderPrintControl.js";
import { IconButton } from "./controls.js";

export function PhoneHeader({
  saveState,
  printers,
  activePrinterId,
  canUndo,
  canRedo,
  canPrint,
  printMenuOpen,
  printerMenuOpen,
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
  onPrint,
  onPrintMenuChange,
  onPrinterMenuChange,
  platform,
}: AppHeaderProps) {
  const onPrintMenuChangeRef = useRef(onPrintMenuChange);
  const unsaved = saveState === "Edited" || saveState === "Not saved";

  useEffect(() => {
    onPrintMenuChangeRef.current = onPrintMenuChange;
  }, [onPrintMenuChange]);

  useEffect(
    () => () => {
      onPrintMenuChangeRef.current(false);
    },
    [],
  );

  return (
    <header className="phone-titlebar">
      <div
        aria-hidden="true"
        className={`phone-window-drag-spacer ${platform === "macos" ? "macos" : ""}`}
      />
      <div className="phone-header-actions">
        <div className="phone-workspace-actions">
          <IconButton
            className="phone-header-icon"
            label="New workspace"
            onClick={onNew}
          >
            <FilePlus2 size={18} />
          </IconButton>
          <IconButton
            className="phone-header-icon"
            label="Open workspace"
            onClick={onOpen}
          >
            <FolderOpen size={18} />
          </IconButton>
          <IconButton
            className={`phone-header-icon phone-save-action${unsaved ? " is-dirty" : ""}`}
            label={`Save workspace, ${saveState}`}
            onClick={onSave}
          >
            <Save size={18} />
          </IconButton>
        </div>
        <div className="phone-history-actions">
          <IconButton
            className="phone-header-icon"
            label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            className="phone-header-icon"
            label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 size={18} />
          </IconButton>
        </div>
        <div className="phone-output-actions">
          <AppHeaderPrinterPicker
            activePrinterId={activePrinterId}
            compactStatus
            menuOpen={printerMenuOpen}
            onAddPrinter={onAddPrinter}
            onOpenPrinterSettings={onOpenPrinterSettings}
            onMenuChange={onPrinterMenuChange}
            onRemovePrinter={onRemovePrinter}
            onSelectPrinter={onSelectPrinter}
            printers={printers}
          />
          <AppHeaderPrintControl
            canPrint={canPrint}
            menuOpen={printMenuOpen}
            onMenuChange={onPrintMenuChange}
            onPrint={(all) => {
              onPrintMenuChange(false);
              onPrint(all);
            }}
            plateCount={plateCount}
          />
        </div>
      </div>
    </header>
  );
}
