import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  elementBounds,
  selectionKey,
  uniqueSelection,
} from "./element-selection.js";
import { snapMovedElement, snapResizedFrame } from "./canvas-snapping.js";
import type { SnapThresholds } from "./canvas-snapping.js";
import type { PrintableMargins } from "./label-layout.js";
import { snapRotationDegrees } from "./rotation.js";

export type ResizeCorner = "nw" | "ne" | "sw" | "se";
type FramedElement = LabelElement;

function trackPointerMovement(
  pointerId: number,
  onMove: (event: PointerEvent) => void,
  onFinish: () => void,
): () => void {
  let active = true;
  const move = (event: PointerEvent) => {
    if (event.pointerId === pointerId) onMove(event);
  };
  const cleanup = () => {
    if (!active) return;
    active = false;
    globalThis.removeEventListener("pointermove", move);
    globalThis.removeEventListener("pointerup", finish);
    globalThis.removeEventListener("pointercancel", finish);
    onFinish();
  };
  const finish = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cleanup();
  };
  globalThis.addEventListener("pointermove", move);
  globalThis.addEventListener("pointerup", finish);
  globalThis.addEventListener("pointercancel", finish);
  return cleanup;
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
  canvasWidthMm = plate.size.widthMm,
  selectedElementId,
  selectedElementIds = selectedElementId ? [selectedElementId] : [],
  onSelectElements,
  onChangeElements,
  onChangeElementsDuringInteraction,
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
  readonly canvasWidthMm?: number;
  readonly selectedElementId: string | null;
  readonly selectedElementIds?: readonly string[];
  readonly onSelectElements?: (ids: readonly string[]) => void;
  readonly onChangeElements?: (elements: readonly LabelElement[]) => void;
  readonly onChangeElementsDuringInteraction?: (
    elements: readonly LabelElement[],
  ) => void;
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
  const canvasSize = { ...plate.size, widthMm: canvasWidthMm };
  const editOnClickRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const [selectionBox, setSelectionBox] = useState<{
    xMm: number;
    yMm: number;
    widthMm: number;
    heightMm: number;
  } | null>(null);
  const selectMany = (ids: readonly string[]) =>
    onSelectElements
      ? onSelectElements(uniqueSelection(plate, ids))
      : onSelectElement(ids[0] ?? null);
  const changeMany = (elements: readonly LabelElement[], during = false) => {
    const callback = during
      ? onChangeElementsDuringInteraction
      : onChangeElements;
    if (callback) callback(elements);
    else
      elements.forEach((element) =>
        (during ? onChangeElementDuringInteraction : onChangeElement)(element),
      );
  };
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const cancelPanRef = useRef<(() => void) | null>(null);
  const cancelElementInteractionRef = useRef<(() => void) | null>(null);
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
      cancelElementInteractionRef.current?.();
    },
    [plate.id],
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
    suppressClickRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const selected = selectedElementIds.includes(element.id);
    editOnClickRef.current =
      selected && selectedElementIds.length === 1 ? element.id : null;
    if (event.ctrlKey || event.metaKey) {
      editOnClickRef.current = null;
      selectMany(
        selected
          ? selectedElementIds.filter((id) => id !== element.id)
          : [
              element.id,
              ...selectedElementIds.filter(
                (id) =>
                  selectionKey(plate, id) !== selectionKey(plate, element.id),
              ),
            ],
      );
      return;
    }
    const moving = selected
      ? plate.elements.filter((item) => selectedElementIds.includes(item.id))
      : [element];
    if (!selected) onSelectElement(element.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = canvasBounds(event.currentTarget);
    if (!bounds) return;
    cancelElementInteractionRef.current?.();
    onInteractionStart();
    const thresholds = {
      xMm: (6 / bounds.width) * canvasWidthMm,
      yMm: (6 / bounds.height) * plate.size.heightMm,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (touchPointersRef.current.size > 1) return;
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) {
        editOnClickRef.current = null;
      }
      const dx = ((moveEvent.clientX - startX) / bounds.width) * canvasWidthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      const frames = moving.map(elementBounds);
      const left = Math.min(...frames.map((frame) => frame.xMm));
      const top = Math.min(...frames.map((frame) => frame.yMm));
      const frame =
        moving.length === 1
          ? element
          : {
              ...element,
              xMm: left,
              yMm: top,
              widthMm:
                Math.max(...frames.map((item) => item.xMm + item.widthMm)) -
                left,
              heightMm:
                Math.max(...frames.map((item) => item.yMm + item.heightMm)) -
                top,
              rotationDeg: 0,
            };
      const snapped = snapMovedElement(
        { ...frame, xMm: frame.xMm + dx, yMm: frame.yMm + dy },
        canvasSize,
        printableMargins,
        thresholds,
      );
      changeMany(
        moving.map((item) => ({
          ...item,
          xMm: item.xMm + snapped.xMm - frame.xMm,
          yMm: item.yMm + snapped.yMm - frame.yMm,
        })),
        true,
      );
    };
    cancelElementInteractionRef.current = trackPointerMovement(
      event.pointerId,
      onMove,
      onInteractionEnd,
    );
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
    cancelElementInteractionRef.current?.();
    onInteractionStart();
    const thresholds = {
      xMm: (6 / bounds.width) * canvasWidthMm,
      yMm: (6 / bounds.height) * plate.size.heightMm,
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (touchPointersRef.current.size > 1) return;
      const dx = ((moveEvent.clientX - startX) / bounds.width) * canvasWidthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      onChangeElementDuringInteraction(
        resizeFrameFromDrag(
          element,
          corner,
          dx,
          dy,
          canvasSize,
          printableMargins,
          thresholds,
          moveEvent.shiftKey,
        ),
      );
    };
    cancelElementInteractionRef.current = trackPointerMovement(
      event.pointerId,
      onMove,
      onInteractionEnd,
    );
  };

  const startRotate = (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: FramedElement,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds) return;
    cancelElementInteractionRef.current?.();
    onInteractionStart();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const onMove = (moveEvent: PointerEvent) => {
      if (touchPointersRef.current.size > 1) return;
      const rotationDeg = snapRotationDegrees(
        (Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX) *
          180) /
          Math.PI +
          (touchNavigation ? -90 : 90),
      );
      onChangeElementDuringInteraction({ ...element, rotationDeg });
    };
    cancelElementInteractionRef.current = trackPointerMovement(
      event.pointerId,
      onMove,
      onInteractionEnd,
    );
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
    const moving = selectedElementIds.includes(element.id)
      ? plate.elements.filter((item) => selectedElementIds.includes(item.id))
      : [element];
    changeMany(
      moving.map((item) => ({
        ...item,
        xMm: item.xMm + offset[0],
        yMm: item.yMm + offset[1],
      })),
    );
  };

  const startSelectionBox = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const bounds = event.currentTarget
      .querySelector<HTMLElement>(".label-canvas")
      ?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    event.preventDefault();
    suppressClickRef.current = true;
    editOnClickRef.current = null;
    cancelElementInteractionRef.current?.();
    const start = {
      xMm: ((event.clientX - bounds.left) / bounds.width) * canvasWidthMm,
      yMm: ((event.clientY - bounds.top) / bounds.height) * plate.size.heightMm,
    };
    const initial = event.ctrlKey || event.metaKey ? selectedElementIds : [];
    selectMany(initial);
    setSelectionBox({ ...start, widthMm: 0, heightMm: 0 });
    cancelElementInteractionRef.current = trackPointerMovement(
      event.pointerId,
      (moveEvent) => {
        const x =
          ((moveEvent.clientX - bounds.left) / bounds.width) * canvasWidthMm;
        const y =
          ((moveEvent.clientY - bounds.top) / bounds.height) *
          plate.size.heightMm;
        const box = {
          xMm: Math.min(start.xMm, x),
          yMm: Math.min(start.yMm, y),
          widthMm: Math.abs(x - start.xMm),
          heightMm: Math.abs(y - start.yMm),
        };
        setSelectionBox(box);
        selectMany([
          ...initial,
          ...plate.elements.flatMap((item) => {
            const frame = elementBounds(item);
            const inside =
              frame.xMm >= box.xMm &&
              frame.yMm >= box.yMm &&
              frame.xMm + frame.widthMm <= box.xMm + box.widthMm &&
              frame.yMm + frame.heightMm <= box.yMm + box.heightMm;
            return inside ? [item.id] : [];
          }),
        ]);
      },
      () => setSelectionBox(null),
    );
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
    suppressClickRef,
    selectionBox,
    startSelectionBox,
    moveWithKeyboard,
    pan,
    startMove,
    startPan,
    startResize,
    startRotate,
    trackTouchPointer,
  };
}
