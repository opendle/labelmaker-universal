import {
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";

import { AppHeaderPrinterPicker } from "./AppHeaderPrinterPicker.js";
import { AppHeaderPrintControl } from "./AppHeaderPrintControl.js";
import { IconButton } from "./controls.js";
import type { HostPlatform, PrinterSummary } from "./host.js";

export interface AppHeaderProps {
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
  readonly onOpenPrinterSettings: (printerId: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onPreview: () => void;
  readonly onPrint: (all: boolean) => void;
  readonly onPrintMenuChange: (open: boolean) => void;
  readonly platform: HostPlatform;
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
  onOpenPrinterSettings,
  onUndo,
  onRedo,
  onPreview,
  onPrint,
  onPrintMenuChange,
  platform,
}: AppHeaderProps) {
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
        <AppHeaderPrinterPicker
          activePrinterId={activePrinterId}
          onAddPrinter={onAddPrinter}
          onOpenPrinterSettings={onOpenPrinterSettings}
          onRemovePrinter={onRemovePrinter}
          onSelectPrinter={onSelectPrinter}
          printers={printers}
        />
        <button className="button secondary" onClick={onPreview} type="button">
          <ImageIcon size={16} /> Preview
        </button>
        <AppHeaderPrintControl
          canPrint={canPrint}
          menuOpen={printMenuOpen}
          onMenuChange={onPrintMenuChange}
          onPrint={onPrint}
          plateCount={plateCount}
        />
      </div>
    </header>
  );
}
