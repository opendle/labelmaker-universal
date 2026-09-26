import { useEffect, useRef, type RefObject } from "react";
import { clamp, MAX_ZOOM, MIN_ZOOM } from "./editor-operations.js";

type ScaleGesture = Event & { readonly scale?: number };

export function useCanvasZoom(
  ref: RefObject<HTMLElement | null>,
  zoom: number,
  onZoom: (zoom: number) => void,
  touch: boolean,
) {
  const current = useRef({ zoom, onZoom });
  current.current = { zoom, onZoom };
  useEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    let gestureStart: number | null = null;
    const touchPointers = new Set<number>();
    let touchGesture = false;
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") touchPointers.add(event.pointerId);
    };
    const pointerEnd = (event: PointerEvent) => {
      touchPointers.delete(event.pointerId);
    };
    const update = (value: number) => {
      if (!Number.isFinite(value)) return;
      const next = clamp(value, MIN_ZOOM, MAX_ZOOM);
      current.current.zoom = next;
      current.current.onZoom(next);
    };
    const wheel = (event: WheelEvent) => {
      if (!event.deltaY || !Number.isFinite(event.deltaY)) return;
      event.preventDefault();
      if (gestureStart !== null) return;
      if (event.ctrlKey) {
        update(current.current.zoom * Math.exp(-event.deltaY * 0.01));
        return;
      }
      // Pixel scroll events arrive more often than mouse wheel steps.
      const pixelScroll = event.deltaMode === 0 && touch;
      const delta = pixelScroll
        ? -event.deltaY * 0.15
        : -Math.sign(event.deltaY) * 10;
      update(current.current.zoom + delta);
    };
    const start = (event: ScaleGesture) => {
      event.preventDefault();
      // Touch pointers already control canvas zoom and pan.
      touchGesture = touch && touchPointers.size > 0;
      if (touchGesture) return;
      gestureStart = current.current.zoom;
    };
    const change = (event: ScaleGesture) => {
      if (
        touchGesture ||
        gestureStart === null ||
        typeof event.scale !== "number" ||
        event.scale <= 0
      )
        return;
      event.preventDefault();
      update(gestureStart * event.scale);
    };
    const end = (event: Event) => {
      event.preventDefault();
      gestureStart = null;
      touchGesture = false;
    };
    // A canvas wheel handler must cancel browser zoom before it changes the plate.
    const previousWheel = surface.onwheel;
    surface.onwheel = wheel;
    surface.addEventListener("gesturestart", start, { passive: false });
    surface.addEventListener("gesturechange", change, { passive: false });
    surface.addEventListener("gestureend", end, { passive: false });
    surface.addEventListener("pointerdown", pointerDown, true);
    globalThis.addEventListener("pointerup", pointerEnd);
    globalThis.addEventListener("pointercancel", pointerEnd);
    return () => {
      surface.onwheel = previousWheel;
      surface.removeEventListener("gesturestart", start);
      surface.removeEventListener("gesturechange", change);
      surface.removeEventListener("gestureend", end);
      surface.removeEventListener("pointerdown", pointerDown, true);
      globalThis.removeEventListener("pointerup", pointerEnd);
      globalThis.removeEventListener("pointercancel", pointerEnd);
    };
  }, [ref, touch]);
}
