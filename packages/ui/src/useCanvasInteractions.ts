import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { snapMovedElement, snapResizedFrame } from "./canvas-snapping.js";
import type { SnapThresholds } from "./canvas-snapping.js";
import type { PrintableMargins } from "./label-layout.js";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
type FramedElement = TextElement | ImageElement | ShapeElement;

function frameWithScale<T extends FramedElement>(
  element: T,
  scale: number,
  edges: { readonly left: boolean; readonly top: boolean },
): T {
  const widthMm = element.widthMm * scale;
  const heightMm = element.heightMm * scale;
  return {
    ...element,
    xMm: edges.left ? element.xMm + element.widthMm - widthMm : element.xMm,
    yMm: edges.top ? element.yMm + element.heightMm - heightMm : element.yMm,
    widthMm,
    heightMm,
  };
}

export function resizeFrameFromDrag<T extends FramedElement>(
  element: T,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  plateSize: LabelPlate["size"],
  printableMargins: PrintableMargins,
  thresholds: SnapThresholds,
  preserveAspectRatio: boolean,
): T {
  const left = corner.includes("w");
  const top = corner.includes("n");
  const edges = { left, top };
  const widthMm = Math.max(0.5, element.widthMm + (left ? -dx : dx));
  const heightMm = Math.max(0.5, element.heightMm + (top ? -dy : dy));

  if (!preserveAspectRatio) {
    return snapResizedFrame(
      {
        ...element,
        xMm: left ? element.xMm + element.widthMm - widthMm : element.xMm,
        yMm: top ? element.yMm + element.heightMm - heightMm : element.yMm,
        widthMm,
        heightMm,
      },
      plateSize,
      printableMargins,
      thresholds,
      edges,
    );
  }

  const widthScale = widthMm / element.widthMm;
  const heightScale = heightMm / element.heightMm;
  const minimumScale = Math.max(0.5 / element.widthMm, 0.5 / element.heightMm);
  const dragScale =
    Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
      ? widthScale
      : heightScale;
  const intendedScale = Math.max(minimumScale, dragScale);
  const proportionalFrame = frameWithScale(element, intendedScale, edges);
  const snappedFrame = snapResizedFrame(
    proportionalFrame,
    plateSize,
    printableMargins,
    thresholds,
    edges,
  );
  const widthWasSnapped =
    Math.abs(snappedFrame.widthMm - proportionalFrame.widthMm) > 1e-9;
  const heightWasSnapped =
    Math.abs(snappedFrame.heightMm - proportionalFrame.heightMm) > 1e-9;

  if (!widthWasSnapped && !heightWasSnapped) return snappedFrame;

  const snappedWidthScale = snappedFrame.widthMm / element.widthMm;
  const snappedHeightScale = snappedFrame.heightMm / element.heightMm;
  const snappedScale =
    widthWasSnapped &&
    (!heightWasSnapped ||
      Math.abs(snappedWidthScale - intendedScale) <=
        Math.abs(snappedHeightScale - intendedScale))
      ? snappedWidthScale
      : snappedHeightScale;

  return frameWithScale(element, Math.max(minimumScale, snappedScale), edges);
}

export function useCanvasInteractions({
  plate,
  selectedElementId,
  editingElementId,
  onSelectElement,
  onChangeElement,
  printableMargins,
  touchNavigation = false,
  zoom,
  onZoom,
}: {
  readonly plate: LabelPlate;
  readonly selectedElementId: string | null;
  readonly editingElementId: string | null;
  readonly onSelectElement: (id: string | null) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly printableMargins: PrintableMargins;
  readonly touchNavigation?: boolean;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
}) {
  const editOnClickRef = useRef<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const cancelPanRef = useRef<(() => void) | null>(null);
  const gestureRef = useRef<{
    readonly pointerIds: readonly [number, number];
    readonly distance: number;
    readonly center: { readonly x: number; readonly y: number };
    readonly pan: { readonly x: number; readonly y: number };
    readonly zoom: number;
  } | null>(null);
  const onZoomRef = useRef(onZoom);
  const zoomRef = useRef(zoom);
  onZoomRef.current = onZoom;
  zoomRef.current = zoom;

  useEffect(
    () => () => {
      cancelPanRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!touchNavigation) return;
    const touchPointers = touchPointersRef.current;
    const onPointerMove = (event: PointerEvent) => {
      if (!touchPointers.has(event.pointerId)) return;
      touchPointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      const gesture = gestureRef.current;
      if (!gesture) return;
      const first = touchPointers.get(gesture.pointerIds[0]);
      const second = touchPointers.get(gesture.pointerIds[1]);
      if (!first || !second) return;
      const center = {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2,
      };
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      setPan({
        x: gesture.pan.x + center.x - gesture.center.x,
        y: gesture.pan.y + center.y - gesture.center.y,
      });
      if (gesture.distance > 0) {
        const nextZoom = Math.round(
          Math.max(
            60,
            Math.min(300, gesture.zoom * (distance / gesture.distance)),
          ),
        );
        if (nextZoom !== zoomRef.current) {
          zoomRef.current = nextZoom;
          onZoomRef.current(nextZoom);
        }
      }
    };
    const onPointerEnd = (event: PointerEvent) => {
      touchPointers.delete(event.pointerId);
      if (
        gestureRef.current?.pointerIds.includes(event.pointerId) ||
        touchPointers.size < 2
      ) {
        gestureRef.current = null;
      }
    };
    globalThis.addEventListener("pointermove", onPointerMove);
    globalThis.addEventListener("pointerup", onPointerEnd);
    globalThis.addEventListener("pointercancel", onPointerEnd);
    return () => {
      globalThis.removeEventListener("pointermove", onPointerMove);
      globalThis.removeEventListener("pointerup", onPointerEnd);
      globalThis.removeEventListener("pointercancel", onPointerEnd);
      touchPointers.clear();
    };
  }, [touchNavigation]);

  const trackTouchPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (!touchNavigation || event.pointerType !== "touch") return false;
    touchPointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (touchPointersRef.current.size < 2) return false;
    const entries = Array.from(touchPointersRef.current.entries()).slice(0, 2);
    const first = entries[0];
    const second = entries[1];
    if (!first || !second) return false;
    cancelPanRef.current?.();
    const [firstId, firstPoint] = first;
    const [secondId, secondPoint] = second;
    gestureRef.current = {
      pointerIds: [firstId, secondId],
      distance: Math.hypot(
        secondPoint.x - firstPoint.x,
        secondPoint.y - firstPoint.y,
      ),
      center: {
        x: (firstPoint.x + secondPoint.x) / 2,
        y: (firstPoint.y + secondPoint.y) / 2,
      },
      pan,
      zoom: zoomRef.current,
    };
    editOnClickRef.current = null;
    event.preventDefault();
    return true;
  };
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
      if (touchPointersRef.current.size > 1) return;
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
      globalThis.removeEventListener("pointercancel", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onUp);
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
      if (touchPointersRef.current.size > 1) return;
      const dx =
        ((moveEvent.clientX - startX) / bounds.width) * plate.size.widthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      onChangeElement(
        resizeFrameFromDrag(
          element,
          corner,
          dx,
          dy,
          plate.size,
          printableMargins,
          thresholds,
          moveEvent.shiftKey,
        ),
      );
    };
    const onUp = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onUp);
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
      if (touchPointersRef.current.size > 1) return;
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
      globalThis.removeEventListener("pointercancel", onUp);
    };
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onUp);
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
    cancelPanRef.current?.();
    const pointerId = event.pointerId;
    const touchPan = touchNavigation && event.pointerType === "touch";
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = pan;
    event.preventDefault();
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (touchPan && touchPointersRef.current.size > 1) return;
      setPan({
        x: initial.x + moveEvent.clientX - startX,
        y: initial.y + moveEvent.clientY - startY,
      });
    };
    const cleanup = () => {
      globalThis.removeEventListener("pointermove", onMove);
      globalThis.removeEventListener("pointerup", onUp);
      globalThis.removeEventListener("pointercancel", onUp);
      if (cancelPanRef.current === cleanup) cancelPanRef.current = null;
    };
    const onUp = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      cleanup();
    };
    cancelPanRef.current = cleanup;
    globalThis.addEventListener("pointermove", onMove);
    globalThis.addEventListener("pointerup", onUp);
    globalThis.addEventListener("pointercancel", onUp);
  };

  return {
    editOnClickRef,
    moveWithKeyboard,
    pan,
    startMove,
    startPan,
    startResize,
    startRotate,
    trackTouchPointer,
  };
}
