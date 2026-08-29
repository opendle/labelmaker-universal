import { ChevronDown, Printer } from "lucide-react";
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
            <button onClick={onPreview} role="menuitem" type="button">
              Preview label
            </button>
          )}
          <button
            disabled={!canPrint}
            onClick={() => onPrint(false)}
            role="menuitem"
            type="button"
          >
            Print current label
          </button>
          <button
            disabled={!canPrint}
            onClick={() => onPrint(true)}
            role="menuitem"
            type="button"
          >
            Print all {plateCount} labels
          </button>
        </div>
      )}
    </div>
  );
}
