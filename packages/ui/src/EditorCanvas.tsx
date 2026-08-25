import type { LabelElement, LabelPlate, TextElement } from "@labelmaker/domain";
import { Flag, Image as ImageIcon, Type, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { CanvasElementView } from "./CanvasElementView.js";
import { IconButton } from "./controls.js";
import { clamp } from "./editor-operations.js";
import { PlateToolbarSettings } from "./Inspector.js";

type ResizeCorner = "nw" | "ne" | "sw" | "se";

function CanvasRulers({
  widthMm,
  heightMm,
  canvasScale,
}: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly canvasScale: number;
}) {
  const horizontal = Array.from(
    { length: Math.floor(widthMm / 5) + 1 },
    (_, index) => index * 5,
  );
  const vertical = Array.from(
    { length: Math.floor(heightMm / 5) + 1 },
    (_, index) => index * 5,
  );
  return (
    <>
      <div className="ruler ruler-top" aria-hidden="true">
        {horizontal.map((mark) => (
          <span
            className={mark === 0 ? "origin" : undefined}
            key={mark}
            style={{ left: `${mark * canvasScale}px` }}
          >
            {mark} mm
          </span>
        ))}
      </div>
      <div className="ruler ruler-left" aria-hidden="true">
        {vertical.map((mark) => (
          <span
            className={mark === 0 ? "origin" : undefined}
            key={mark}
            style={{ top: `${mark * canvasScale}px` }}
          >
            {mark} mm
          </span>
        ))}
      </div>
    </>
  );
}

function CanvasZoomControl({
  zoom,
  onZoom,
}: {
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
}) {
  return (
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
  );
}

function CanvasToolbar({
  plate,
  onAddText,
  onAddImage,
  onAddSpecial,
  onUpdatePlate,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  return (
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
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) onAddImage(file);
            event.target.value = "";
          }}
          type="file"
        />
        <span className="toolbar-separator" />
        <button
          aria-pressed={plate.name.startsWith("Flag ")}
          className="tool-button"
          onClick={() => onAddSpecial("flag")}
          type="button"
        >
          <Flag size={16} /> Flag
        </button>
      </div>
      <PlateToolbarSettings
        onChange={onUpdatePlate}
        onTrim={onTrim}
        plate={plate}
      />
    </div>
  );
}

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
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onSelectElement: (id: string | null) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const editOnClickRef = useRef<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
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

  return (
    <main className="editor-area">
      <CanvasToolbar
        onAddImage={onAddImage}
        onAddSpecial={onAddSpecial}
        onAddText={onAddText}
        onTrim={onTrim}
        onUpdatePlate={onUpdatePlate}
        plate={plate}
      />
      <div
        className="work-surface"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest(".canvas-element, .zoom-control, button") ||
            target.closest(".canvas-clear-selection")
          ) {
            startPan(event);
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          onZoom(clamp(zoom + (event.deltaY < 0 ? 10 : -10), 60, 140));
        }}
      >
        <div
          className="canvas-stage"
          style={
            {
              transform: `translate(${pan.x}px, ${pan.y}px)`,
              "--grid-step": `${5 * canvasScale}px`,
            } as CSSProperties
          }
        >
          <CanvasRulers
            canvasScale={canvasScale}
            heightMm={plate.size.heightMm}
            widthMm={plate.size.widthMm}
          />
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
        </div>
        <div className="canvas-meta">
          203 dpi · Print area {plate.size.widthMm} × {plate.size.heightMm} mm
        </div>
        <CanvasZoomControl onZoom={onZoom} zoom={zoom} />
      </div>
    </main>
  );
}
