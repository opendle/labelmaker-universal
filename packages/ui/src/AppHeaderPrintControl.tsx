import { ChevronDown, Eye, Files, Printer } from "lucide-react";
import { useEffect, useRef } from "react";

export function AppHeaderPrintControl({
  plateCount,
  canPrint,
  menuOpen,
  onPrint,
  onPreview,
  onMenuChange,
}: {
  readonly plateCount: number;
  readonly canPrint: boolean;
  readonly menuOpen: boolean;
  readonly onPrint: (all: boolean) => void;
  readonly onPreview?: () => void;
  readonly onMenuChange: (open: boolean) => void;
}) {
  const controlRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onMenuChangeRef = useRef(onMenuChange);

  useEffect(() => {
    onMenuChangeRef.current = onMenuChange;
  }, [onMenuChange]);

  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) {
        onMenuChangeRef.current(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        onDocumentPointerDown,
      );
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
      onMenuChange(false);
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
    <div className="print-control" ref={controlRef}>
      <button
        aria-label="Print"
        className="button primary"
        disabled={!canPrint}
        onClick={() => onPrint(false)}
        type="button"
      >
        <Printer size={16} /> <span className="print-label">Print</span>
      </button>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-label="Print options"
        className="button primary split"
        disabled={!canPrint && !onPreview}
        onClick={() => {
          const nextOpen = !menuOpen;
          onMenuChange(nextOpen);
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
      {menuOpen && (
        <div
          aria-label="Print options"
          className="popup-menu"
          onKeyDown={onMenuKeyDown}
          ref={menuRef}
          role="menu"
          tabIndex={-1}
        >
          {onPreview && (
            <button
              className="popup-menu-item"
              onClick={onPreview}
              role="menuitem"
              type="button"
            >
              <Eye aria-hidden="true" size={16} />
              <span>Preview label</span>
            </button>
          )}
          <button
            className="popup-menu-item"
            disabled={!canPrint}
            onClick={() => onPrint(false)}
            role="menuitem"
            type="button"
          >
            <Printer aria-hidden="true" size={16} />
            <span>Print current label</span>
          </button>
          <button
            className="popup-menu-item"
            disabled={!canPrint}
            onClick={() => onPrint(true)}
            role="menuitem"
            type="button"
          >
            <Files aria-hidden="true" size={16} />
            <span>Print all {plateCount} labels</span>
          </button>
        </div>
      )}
    </div>
  );
}
