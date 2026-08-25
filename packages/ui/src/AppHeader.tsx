import {
  ChevronDown,
  Image as ImageIcon,
  Printer,
  Redo2,
  Save,
  Undo2,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { IconButton } from "./controls.js";
import type { HostPlatform } from "./host.js";

export function AppHeader({
  workspaceName,
  plateCount,
  saveState,
  canUndo,
  canRedo,
  canPrint,
  printMenuOpen,
  onUndo,
  onRedo,
  onPreview,
  onSave,
  onPrint,
  onPrintMenuChange,
  platform,
}: {
  readonly workspaceName: string;
  readonly plateCount: number;
  readonly saveState: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPrint: boolean;
  readonly printMenuOpen: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onPreview: () => void;
  readonly onSave: () => void;
  readonly onPrint: (all: boolean) => void;
  readonly onPrintMenuChange: (open: boolean) => void;
  readonly platform: HostPlatform;
}) {
  const controlRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onPrintMenuChange);
  const menuOpenRef = useRef(printMenuOpen);
  closeRef.current = onPrintMenuChange;
  menuOpenRef.current = printMenuOpen;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (
        menuOpenRef.current &&
        !controlRef.current?.contains(event.target as Node)
      ) {
        closeRef.current(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", onPointerDown);
    return () =>
      globalThis.document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      controlRef.current?.querySelector<HTMLButtonElement>(".split")?.focus();
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
      {platform === "macos" ? (
        <div className="traffic-lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div aria-hidden="true" className="window-drag-spacer" />
      )}
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
        <button className="button secondary" onClick={onPreview} type="button">
          <ImageIcon size={16} /> Preview
        </button>
        <button className="button secondary" onClick={onSave} type="button">
          <Save size={16} /> Save
        </button>
        <div className="print-control" ref={controlRef}>
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
                  menuRef.current
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
              onKeyDown={onMenuKeyDown}
              ref={menuRef}
              role="menu"
              tabIndex={-1}
            >
              <button
                onClick={() => onPrint(false)}
                role="menuitem"
                type="button"
              >
                Print current plate
              </button>
              <button
                onClick={() => onPrint(true)}
                role="menuitem"
                type="button"
              >
                Print all {plateCount} plates
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
