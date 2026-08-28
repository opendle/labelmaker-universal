import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { snapMovedElement, snapResizedFrame } from "./canvas-snapping.js";
import type { PrintableMargins } from "./label-layout.js";

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type FramedElement = TextElement | ImageElement | ShapeElement;

export function useCanvasInteractions({
  plate,
  selectedElementId,
  editingElementId,
  onSelectElement,
  onChangeElement,
  printableMargins,
}: {
  readonly plate: LabelPlate;
  readonly selectedElementId: string | null;
  readonly editingElementId: string | null;
  readonly onSelectElement: (id: string | null) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly printableMargins: PrintableMargins;
}) {
  const editOnClickRef = useRef<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasBounds = (elementNode: HTMLElement) =>
    elementNode.closest<HTMLElement>(".label-canvas")?.getBoundingClientRect();

  const startMove = (
    event: ReactPointerEvent<HTMLElement>,
    element: LabelElement,
  ) => {
    if (
      (typeof event.button === "number" && event.button !== 0) ||
      (event.target as HTMLElement).closest(".handle, [contenteditable=true]")
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    editOnClickRef.current =
      element.id === selectedElementId ? element.id : null;
    onSelectElement(element.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = canvasBounds(event.currentTarget);
    if (!bounds) return;
    const thresholds = {
      xMm: (6 / bounds.width) * plate.size.widthMm,
      yMm: (6 / bounds.height) * plate.size.heightMm,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) {
        editOnClickRef.current = null;
      }
      onChangeElement(
        snapMovedElement(
          {
            ...element,
            xMm:
              element.xMm +
              ((moveEvent.clientX - startX) / bounds.width) *
                plate.size.widthMm,
            yMm:
              element.yMm +
              ((moveEvent.clientY - startY) / bounds.height) *
                plate.size.heightMm,
          },
          plate.size,
          printableMargins,
          thresholds,
        ),
      );
    };
    const onUp = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
  };

  const startResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: FramedElement,
    corner: ResizeCorner,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = canvasBounds(event.currentTarget);
    if (!bounds) return;
    const thresholds = {
      xMm: (6 / bounds.width) * plate.size.widthMm,
      yMm: (6 / bounds.height) * plate.size.heightMm,
    };
    const onMove = (moveEvent: PointerEvent) => {
      const dx =
        ((moveEvent.clientX - startX) / bounds.width) * plate.size.widthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      const left = corner.includes("w");
      const top = corner.includes("n");
      const widthMm = Math.max(0.5, element.widthMm + (left ? -dx : dx));
      const heightMm = Math.max(0.5, element.heightMm + (top ? -dy : dy));
      onChangeElement(
        snapResizedFrame(
          {
            ...element,
            xMm: left ? element.xMm + element.widthMm - widthMm : element.xMm,
            yMm: top ? element.yMm + element.heightMm - heightMm : element.yMm,
            widthMm,
            heightMm,
          },
          plate.size,
          printableMargins,
          thresholds,
          { left, top },
        ),
      );
    };
    const onUp = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
  };

  const startRotate = (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: FramedElement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const onMove = (moveEvent: PointerEvent) => {
      const rotationDeg = Math.round(
        (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) *
          180) /
          Math.PI +
          90,
      );
      onChangeElement({ ...element, rotationDeg });
    };
    const onUp = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
  };

  const moveWithKeyboard = (
    event: KeyboardEvent<HTMLElement>,
    element: LabelElement,
  ) => {
    if (editingElementId === element.id) return;
    const delta = event.shiftKey ? 1 : 0.1;
    const offsets: Partial<Record<string, readonly [number, number]>> = {
      ArrowLeft: [-delta, 0],
      ArrowRight: [delta, 0],
      ArrowUp: [0, -delta],
      ArrowDown: [0, delta],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    onChangeElement({
      ...element,
      xMm: element.xMm + offset[0],
      yMm: element.yMm + offset[1],
    });
  };

  const startPan = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = pan;
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) =>
      setPan({
        x: initial.x + moveEvent.clientX - startX,
        y: initial.y + moveEvent.clientY - startY,
      });
    const onUp = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
  };

  return {
    editOnClickRef,
    moveWithKeyboard,
    pan,
    startMove,
    startPan,
    startResize,
    startRotate,
  };
}
