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
import { snapRotationDegrees } from "./rotation.js";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
type FramedElement = TextElement | ImageElement | ShapeElement;

function trackPointerMovement(
  pointerId: number,
  onMove: (event: PointerEvent) => void,
  onFinish: () => void,
): void {
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointerId) onMove(event);
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    globalThis.removeEventListener("pointermove", move);
    globalThis.removeEventListener("pointerup", finish);
    globalThis.removeEventListener("pointercancel", finish);
    onFinish();
  };
  globalThis.addEventListener("pointermove", move);
  globalThis.addEventListener("pointerup", finish);
  globalThis.addEventListener("pointercancel", finish);
}

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

function rotateVector(x: number, y: number, rotationDeg: number) {
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rotatedX = x * cosine - y * sine;
  const rotatedY = x * sine + y * cosine;
  return {
    x: Math.abs(rotatedX) < 1e-12 ? 0 : rotatedX,
    y: Math.abs(rotatedY) < 1e-12 ? 0 : rotatedY,
  };
}

function anchorRotatedResize<T extends FramedElement>(
  element: T,
  resized: T,
  edges: { readonly left: boolean; readonly top: boolean },
): T {
  if (element.rotationDeg % 360 === 0) return resized;

  const horizontalDirection = edges.left ? -1 : 1;
  const verticalDirection = edges.top ? -1 : 1;
  const originalCenter = {
    x: element.xMm + element.widthMm / 2,
    y: element.yMm + element.heightMm / 2,
  };
  const oppositeCornerOffset = rotateVector(
    (-horizontalDirection * element.widthMm) / 2,
    (-verticalDirection * element.heightMm) / 2,
    element.rotationDeg,
  );
  const oppositeCorner = {
    x: originalCenter.x + oppositeCornerOffset.x,
    y: originalCenter.y + oppositeCornerOffset.y,
  };
  const resizedCenterOffset = rotateVector(
    (horizontalDirection * resized.widthMm) / 2,
    (verticalDirection * resized.heightMm) / 2,
    element.rotationDeg,
  );
  const resizedCenter = {
    x: oppositeCorner.x + resizedCenterOffset.x,
    y: oppositeCorner.y + resizedCenterOffset.y,
  };

  return {
    ...resized,
    xMm: resizedCenter.x - resized.widthMm / 2,
    yMm: resizedCenter.y - resized.heightMm / 2,
  };
}

function rotatedFrameBounds(frame: FramedElement) {
  const center = {
    x: frame.xMm + frame.widthMm / 2,
    y: frame.yMm + frame.heightMm / 2,
  };
  const corners = [-1, 1].flatMap((horizontalDirection) =>
    [-1, 1].map((verticalDirection) => {
      const offset = rotateVector(
        (horizontalDirection * frame.widthMm) / 2,
        (verticalDirection * frame.heightMm) / 2,
        frame.rotationDeg,
      );
      return { x: center.x + offset.x, y: center.y + offset.y };
    }),
  );
  const xValues = corners.map(({ x }) => x);
  const yValues = corners.map(({ y }) => y);
  const left = Math.min(...xValues);
  const top = Math.min(...yValues);
  return {
    xMm: left,
    yMm: top,
    widthMm: Math.max(...xValues) - left,
    heightMm: Math.max(...yValues) - top,
    rotationDeg: 0,
  };
}

function snapResizeCandidate<T extends FramedElement>(
  element: T,
  resized: T,
  edges: { readonly left: boolean; readonly top: boolean },
  plateSize: LabelPlate["size"],
  printableMargins: PrintableMargins,
  thresholds: SnapThresholds,
): T {
  const normalizedRotation = ((element.rotationDeg % 360) + 360) % 360;
  if (normalizedRotation === 0) {
    return snapResizedFrame(
      resized,
      plateSize,
      printableMargins,
      thresholds,
      edges,
    );
  }

  if (
    normalizedRotation === 90 ||
    normalizedRotation === 180 ||
    normalizedRotation === 270
  ) {
    const anchored = anchorRotatedResize(element, resized, edges);
    const draggedCornerDirection = rotateVector(
      edges.left ? -1 : 1,
      edges.top ? -1 : 1,
      normalizedRotation,
    );
    const snappedBounds = snapResizedFrame(
      rotatedFrameBounds(anchored),
      plateSize,
      printableMargins,
      thresholds,
      {
        left: draggedCornerDirection.x < 0,
        top: draggedCornerDirection.y < 0,
      },
    );
    const swapsDimensions =
      normalizedRotation === 90 || normalizedRotation === 270;
    return anchorRotatedResize(
      element,
      {
        ...resized,
        widthMm: swapsDimensions
          ? snappedBounds.heightMm
          : snappedBounds.widthMm,
        heightMm: swapsDimensions
          ? snappedBounds.widthMm
          : snappedBounds.heightMm,
      },
      edges,
    );
  }

  return anchorRotatedResize(
    element,
    snapResizedFrame(resized, plateSize, printableMargins, thresholds, edges),
    edges,
  );
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
  const localDrag = rotateVector(dx, dy, -element.rotationDeg);
  const widthMm = Math.max(
    0.5,
    element.widthMm + (left ? -localDrag.x : localDrag.x),
  );
  const heightMm = Math.max(
    0.5,
    element.heightMm + (top ? -localDrag.y : localDrag.y),
  );

  if (!preserveAspectRatio) {
    return snapResizeCandidate(
      element,
      {
        ...element,
        xMm: left ? element.xMm + element.widthMm - widthMm : element.xMm,
        yMm: top ? element.yMm + element.heightMm - heightMm : element.yMm,
        widthMm,
        heightMm,
      },
      edges,
      plateSize,
      printableMargins,
      thresholds,
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
  const snappedFrame = snapResizeCandidate(
    element,
    proportionalFrame,
    edges,
    plateSize,
    printableMargins,
    thresholds,
  );
  const widthWasSnapped =
    Math.abs(snappedFrame.widthMm - proportionalFrame.widthMm) > 1e-9;
  const heightWasSnapped =
    Math.abs(snappedFrame.heightMm - proportionalFrame.heightMm) > 1e-9;

  if (!widthWasSnapped && !heightWasSnapped) {
    return anchorRotatedResize(element, snappedFrame, edges);
  }

  const snappedWidthScale = snappedFrame.widthMm / element.widthMm;
  const snappedHeightScale = snappedFrame.heightMm / element.heightMm;
  const snappedScale =
    widthWasSnapped &&
    (!heightWasSnapped ||
      Math.abs(snappedWidthScale - intendedScale) <=
        Math.abs(snappedHeightScale - intendedScale))
      ? snappedWidthScale
      : snappedHeightScale;

  return anchorRotatedResize(
    element,
    frameWithScale(element, Math.max(minimumScale, snappedScale), edges),
    edges,
  );
}

export function useCanvasInteractions({
  plate,
  selectedElementId,
  editingElementId,
  onSelectElement,
  onChangeElement,
  onChangeElementDuringInteraction,
  onInteractionStart,
  onInteractionEnd,
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
  readonly onChangeElementDuringInteraction: (element: LabelElement) => void;
  readonly onInteractionStart: () => void;
  readonly onInteractionEnd: () => void;
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
    onInteractionStart();
    const thresholds = {
      xMm: (6 / bounds.width) * plate.size.widthMm,
      yMm: (6 / bounds.height) * plate.size.heightMm,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (touchPointersRef.current.size > 1) return;
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) {
        editOnClickRef.current = null;
      }
      onChangeElementDuringInteraction(
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
    trackPointerMovement(event.pointerId, onMove, onInteractionEnd);
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
    onInteractionStart();
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
      onChangeElementDuringInteraction(
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
    trackPointerMovement(event.pointerId, onMove, onInteractionEnd);
  };

  const startRotate = (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: FramedElement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    onInteractionStart();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const onMove = (moveEvent: PointerEvent) => {
      if (touchPointersRef.current.size > 1) return;
      const rotationDeg = snapRotationDegrees(
        (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) *
          180) /
          Math.PI +
          90,
      );
      onChangeElementDuringInteraction({ ...element, rotationDeg });
    };
    trackPointerMovement(event.pointerId, onMove, onInteractionEnd);
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
