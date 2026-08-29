import { FilePlus2, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { AppHeaderProps } from "./AppHeader.js";
import { AppHeaderPrinterPicker } from "./AppHeaderPrinterPicker.js";
import { AppHeaderPrintControl } from "./AppHeaderPrintControl.js";

export function PhoneHeader({
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
          <PhoneHeaderAction label="New workspace" onClick={onNew}>
            <FilePlus2 size={18} />
          </PhoneHeaderAction>
          <PhoneHeaderAction label="Open workspace" onClick={onOpen}>
            <FolderOpen size={18} />
          </PhoneHeaderAction>
          <PhoneHeaderAction
            className={`phone-save-action${unsaved ? " is-dirty" : ""}`}
            label={`Save workspace, ${saveState}`}
            onClick={onSave}
          >
            <Save size={18} />
          </PhoneHeaderAction>
        </div>
        <div className="phone-history-actions">
          <PhoneHeaderAction label="Undo" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={18} />
          </PhoneHeaderAction>
          <PhoneHeaderAction label="Redo" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={18} />
          </PhoneHeaderAction>
        </div>
        <div className="phone-output-actions">
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
      </div>
    </header>
  );
}

function PhoneHeaderAction({
  children,
  className = "",
  disabled = false,
  label,
  onClick,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={`phone-header-icon ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
