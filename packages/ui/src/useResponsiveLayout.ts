import { useEffect, useState } from "react";

import type { HostPlatform } from "./host.js";

export type ResponsiveLayout = "standard" | "phone" | "phone-short";

export function responsiveLayoutForViewport(
  width: number,
  unobscuredHeight: number,
): ResponsiveLayout {
  const phoneWidth = width <= 600;
  const phoneHeight = unobscuredHeight <= 500 && width <= 1_000;
  if (!phoneWidth && !phoneHeight) return "standard";
  return unobscuredHeight <= 500 ? "phone-short" : "phone";
}

function editableHasFocus(): boolean {
  const activeElement = globalThis.document?.activeElement;
  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement
  );
}

export function useResponsiveLayout(platform: HostPlatform): {
  readonly layout: ResponsiveLayout;
  readonly softwareKeyboardOpen: boolean;
} {
  const [layout, setLayout] = useState<ResponsiveLayout>(() =>
    responsiveLayoutForViewport(globalThis.innerWidth, globalThis.innerHeight),
  );
  const [softwareKeyboardOpen, setSoftwareKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = platform === "ipados" ? globalThis.visualViewport : null;
    let viewportWidth = globalThis.innerWidth;
    let unobscuredHeight = Math.max(
      viewport?.height ?? 0,
      globalThis.innerHeight,
    );
    let keyboardWasOpen = false;

    const update = () => {
      const width = globalThis.innerWidth;
      const visibleHeight = viewport?.height ?? globalThis.innerHeight;
      const widthChanged = Math.abs(width - viewportWidth) > 1;
      const hasEditableFocus = editableHasFocus();
      const viewportIsReduced = unobscuredHeight - visibleHeight > 80;

      if (widthChanged) {
        unobscuredHeight = Math.max(visibleHeight, globalThis.innerHeight);
        viewportWidth = width;
        keyboardWasOpen = false;
      } else if (visibleHeight > unobscuredHeight) {
        unobscuredHeight = visibleHeight;
      } else if (!hasEditableFocus && !keyboardWasOpen && !viewportIsReduced) {
        unobscuredHeight = visibleHeight;
      }

      const keyboardOpen =
        platform === "ipados" &&
        unobscuredHeight - visibleHeight > 80 &&
        (hasEditableFocus || keyboardWasOpen);
      keyboardWasOpen = keyboardOpen;
      setSoftwareKeyboardOpen(keyboardOpen);
      setLayout(responsiveLayoutForViewport(width, unobscuredHeight));

      if (viewport) {
        globalThis.document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${viewport.height}px`,
        );
        globalThis.document.documentElement.style.setProperty(
          "--visual-viewport-offset-top",
          `${viewport.offsetTop}px`,
        );
      }
    };

    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update, { passive: true });
    globalThis.addEventListener("resize", update);
    globalThis.document.addEventListener("focusin", update);
    globalThis.document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      globalThis.removeEventListener("resize", update);
      globalThis.document.removeEventListener("focusin", update);
      globalThis.document.removeEventListener("focusout", update);
      globalThis.document.documentElement.style.removeProperty(
        "--visual-viewport-height",
      );
      globalThis.document.documentElement.style.removeProperty(
        "--visual-viewport-offset-top",
      );
    };
  }, [platform]);

  return { layout, softwareKeyboardOpen };
}
