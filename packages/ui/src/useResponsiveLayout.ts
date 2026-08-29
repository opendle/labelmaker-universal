import { useEffect, useState } from "react";

import type { HostPlatform } from "./host.js";

export type ResponsiveLayout = "standard" | "phone" | "phone-short";

export function responsiveLayoutForViewport(
  width: number,
  unobscuredHeight: number,
  phoneWidth = 600,
): ResponsiveLayout {
  const narrowViewport = width <= phoneWidth;
  const phoneHeight = unobscuredHeight <= 500 && width <= 1_000;
  if (!narrowViewport && !phoneHeight) return "standard";
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
  const phoneWidth = platform === "ipados" ? 600 : 1_100;
  const [layout, setLayout] = useState<ResponsiveLayout>(() =>
    responsiveLayoutForViewport(
      globalThis.innerWidth,
      globalThis.innerHeight,
      phoneWidth,
    ),
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
      setLayout(
        responsiveLayoutForViewport(width, unobscuredHeight, phoneWidth),
      );

      if (viewport) {
        const layoutHeight = keyboardOpen ? visibleHeight : unobscuredHeight;
        globalThis.document.documentElement.style.setProperty(
          "--visual-viewport-height",
          `${layoutHeight}px`,
        );
        globalThis.document.documentElement.style.setProperty(
          "--visual-viewport-offset-top",
          `${keyboardOpen ? viewport.offsetTop : 0}px`,
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
  }, [phoneWidth, platform]);

  return { layout, softwareKeyboardOpen };
}
