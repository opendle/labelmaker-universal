import { useEffect, useRef, type ReactNode } from "react";

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Modal({
  children,
  className = "",
  labelId,
  onClose,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly labelId: string;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = globalThis.document.activeElement;
    const background = globalThis.document.querySelector<HTMLElement>(
      ".application-content",
    );
    background?.setAttribute("inert", "");
    background?.setAttribute("aria-hidden", "true");

    const initial =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(focusableSelector);
    initial?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        globalThis.document.activeElement === last
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    globalThis.document.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.document.removeEventListener("keydown", handleKeyDown);
      background?.removeAttribute("inert");
      background?.removeAttribute("aria-hidden");
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className={`modal-backdrop ${className}`}>
      <section
        aria-labelledby={labelId}
        aria-modal="true"
        className={`dialog ${className.includes("preview") ? "preview-dialog" : ""}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
