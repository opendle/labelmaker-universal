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
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(
    globalThis.document.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null,
  );
  const previousFocusWasVisibleRef = useRef(
    previousFocusRef.current?.dataset.focusRingSuppressed !== "true" &&
      previousFocusRef.current?.matches(":focus-visible") === true,
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = previousFocusRef.current;
    const previousFocusWasVisible = previousFocusWasVisibleRef.current;
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
        onCloseRef.current();
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
      if (previousFocus) {
        if (!previousFocusWasVisible) {
          previousFocus.dataset.focusRingSuppressed = "true";
        }
        previousFocus.focus();
        if (!previousFocusWasVisible) {
          const clearSuppression = () => {
            delete previousFocus.dataset.focusRingSuppressed;
            previousFocus.removeEventListener("blur", clearSuppression);
            globalThis.document.removeEventListener(
              "keydown",
              clearSuppression,
              true,
            );
            globalThis.document.removeEventListener(
              "pointerdown",
              clearSuppression,
              true,
            );
          };
          previousFocus.addEventListener("blur", clearSuppression, {
            once: true,
          });
          globalThis.queueMicrotask(() => {
            if (previousFocus.dataset.focusRingSuppressed !== "true") return;
            globalThis.document.addEventListener(
              "keydown",
              clearSuppression,
              true,
            );
            globalThis.document.addEventListener(
              "pointerdown",
              clearSuppression,
              true,
            );
          });
        }
      }
    };
  }, []);

  return (
    <div className={`modal-backdrop ${className}`}>
      <section
        aria-labelledby={labelId}
        aria-modal="true"
        className="dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
