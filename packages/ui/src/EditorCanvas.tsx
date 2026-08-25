import type { LabelElement, LabelPlate, TextElement } from "@labelmaker/domain";
import {
  Cable,
  Flag,
  Image as ImageIcon,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { CanvasElementView } from "./CanvasElementView.js";
import { IconButton } from "./controls.js";
import { clamp } from "./editor-operations.js";
import { PlateToolbarSettings } from "./Inspector.js";

type ResizeCorner = "nw" | "ne" | "sw" | "se";

export function EditorCanvas({
  plate,
  selectedElementId,
  zoom,
  onAddText,
  onAddImage,
  onAddSpecial,
  onSelectElement,
  onChangeElement,
  onUpdatePlate,
  onTrim,
  onZoom,
}: {
  readonly plate: LabelPlate;
  readonly selectedElementId: string | null;
  readonly zoom: number;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onAddSpecial: (kind: "flag" | "wrap") => void;
  readonly onSelectElement: (id: string | null) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const editOnClickRef = useRef<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const canvasScale = Math.min(9, 720 / plate.size.widthMm) * (zoom / 100);
  const canvasBounds = (elementNode: HTMLElement) =>
    elementNode.closest<HTMLElement>(".label-canvas")?.getBoundingClientRect();

  useEffect(() => {
    if (!editingElementId) return;
    const editor = Array.from(
      globalThis.document.querySelectorAll<HTMLElement>(".inline-text-editor"),
    ).find((item) => item.dataset.elementId === editingElementId);
    editor?.focus();
  }, [editingElementId]);

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
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.clientX !== startX || moveEvent.clientY !== startY) {
        editOnClickRef.current = null;
      }
      onChangeElement({
        ...element,
        xMm:
          element.xMm +
          ((moveEvent.clientX - startX) / bounds.width) * plate.size.widthMm,
        yMm:
          element.yMm +
          ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm,
      });
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
    element: TextElement,
    corner: ResizeCorner,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = canvasBounds(event.currentTarget);
    if (!bounds) return;
    const onMove = (moveEvent: PointerEvent) => {
      const dx =
        ((moveEvent.clientX - startX) / bounds.width) * plate.size.widthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      const left = corner.includes("w");
      const top = corner.includes("n");
      const widthMm = Math.max(0.5, element.widthMm + (left ? -dx : dx));
      const heightMm = Math.max(0.5, element.heightMm + (top ? -dy : dy));
      onChangeElement({
        ...element,
        xMm: left ? element.xMm + element.widthMm - widthMm : element.xMm,
        yMm: top ? element.yMm + element.heightMm - heightMm : element.yMm,
        widthMm,
        heightMm,
      });
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
    element: TextElement,
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

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onAddImage(file);
    event.target.value = "";
  };

  return (
    <main className="editor-area">
      <div className="editor-toolbar">
        <div className="editor-tools">
          <button className="tool-button" onClick={onAddText} type="button">
            <Type size={17} /> Add text
          </button>
          <button
            className="tool-button"
            onClick={() => imageInputRef.current?.click()}
            type="button"
          >
            <ImageIcon size={17} /> Add image
          </button>
          <input
            ref={imageInputRef}
            accept="image/*"
            aria-label="Choose image"
            className="file-input"
            onChange={chooseImage}
            type="file"
          />
          <span className="toolbar-separator" />
          <button
            className="tool-button"
            onClick={() => onAddSpecial("flag")}
            type="button"
          >
            <Flag size={16} /> Flag
          </button>
          <button
            className="tool-button"
            onClick={() => onAddSpecial("wrap")}
            type="button"
          >
            <Cable size={16} /> Wrap
          </button>
        </div>
        <PlateToolbarSettings
          onChange={onUpdatePlate}
          onTrim={onTrim}
          plate={plate}
        />
      </div>
      <div className="work-surface">
        <div className="ruler ruler-top" aria-hidden="true" />
        <section
          aria-label={`${plate.name} label canvas`}
          className="label-canvas"
          style={{
            width: `${plate.size.widthMm * canvasScale}px`,
            height: `${plate.size.heightMm * canvasScale}px`,
          }}
        >
          <button
            aria-label="Clear element selection"
            className="canvas-clear-selection"
            onClick={() => onSelectElement(null)}
            tabIndex={-1}
            type="button"
          />
          {plate.elements.map((element) => (
            <CanvasElementView
              canvasScale={canvasScale}
              editing={element.id === editingElementId}
              element={element}
              key={element.id}
              onActivate={(target) => {
                if (
                  editOnClickRef.current === target.id &&
                  target.kind === "text"
                ) {
                  setEditingElementId(target.id);
                } else {
                  onSelectElement(target.id);
                }
                editOnClickRef.current = null;
              }}
              onDoubleClick={(target) => {
                if (target.kind === "text") setEditingElementId(target.id);
              }}
              onEndEdit={() => setEditingElementId(null)}
              onFocus={(target) => onSelectElement(target.id)}
              onMoveKey={moveWithKeyboard}
              onMoveStart={startMove}
              onResizeStart={startResize}
              onRotateStart={startRotate}
              onTextInput={(target, text) =>
                onChangeElement({ ...target, text })
              }
              plate={plate}
              selected={element.id === selectedElementId}
            />
          ))}
        </section>
        <div className="canvas-meta">
          203 dpi · Print area {plate.size.widthMm} × {plate.size.heightMm} mm
        </div>
        <div className="zoom-control">
          <IconButton
            label="Zoom out"
            onClick={() => onZoom(clamp(zoom - 10, 60, 140))}
          >
            <ZoomOut size={15} />
          </IconButton>
          <span>{zoom}%</span>
          <IconButton
            label="Zoom in"
            onClick={() => onZoom(clamp(zoom + 10, 60, 140))}
          >
            <ZoomIn size={15} />
          </IconButton>
        </div>
      </div>
    </main>
  );
}
