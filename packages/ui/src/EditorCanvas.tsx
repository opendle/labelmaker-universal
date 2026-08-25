import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import {
  Cable,
  Flag,
  Image as ImageIcon,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { IconButton, SelectionHandles } from "./controls.js";
import { clamp } from "./editor-operations.js";

export function EditorCanvas({
  plate,
  selectedElementId,
  zoom,
  onAddText,
  onAddImage,
  onAddSpecial,
  onSelectElement,
  onMoveElement,
  onZoom,
}: {
  readonly plate: LabelPlate;
  readonly selectedElementId: string | null;
  readonly zoom: number;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onAddSpecial: (kind: "flag" | "wrap") => void;
  readonly onSelectElement: (id: string | null) => void;
  readonly onMoveElement: (id: string, xMm: number, yMm: number) => void;
  readonly onZoom: (zoom: number) => void;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canvasScale = Math.min(9, 720 / plate.size.widthMm) * (zoom / 100);

  const startMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
    element: LabelElement,
  ) => {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectElement(element.id);
    const startX = event.clientX;
    const startY = event.clientY;
    const canvas = event.currentTarget.parentElement;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const onMove = (moveEvent: PointerEvent) => {
      const dx =
        ((moveEvent.clientX - startX) / bounds.width) * plate.size.widthMm;
      const dy =
        ((moveEvent.clientY - startY) / bounds.height) * plate.size.heightMm;
      onMoveElement(
        element.id,
        clamp(
          element.xMm + dx,
          0,
          Math.max(0, plate.size.widthMm - element.widthMm),
        ),
        clamp(
          element.yMm + dy,
          0,
          Math.max(0, plate.size.heightMm - element.heightMm),
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

  const moveWithKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    element: LabelElement,
  ) => {
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
    onMoveElement(
      element.id,
      clamp(
        element.xMm + offset[0],
        0,
        Math.max(0, plate.size.widthMm - element.widthMm),
      ),
      clamp(
        element.yMm + offset[1],
        0,
        Math.max(0, plate.size.heightMm - element.heightMm),
      ),
    );
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onAddImage(file);
    event.target.value = "";
  };

  return (
    <main className="editor-area">
      <div className="editor-toolbar">
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
        <span className="toolbar-label">SPECIAL</span>
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
        <span className="toolbar-separator" />
        <span className="plate-title">{plate.name}</span>
        <span className="media-pill">
          {plate.size.widthMm} × {plate.size.heightMm} mm
        </span>
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
          {plate.elements.map((element) => {
            const isSelected = element.id === selectedElementId;
            const frameStyle = {
              left: `${(element.xMm / plate.size.widthMm) * 100}%`,
              top: `${(element.yMm / plate.size.heightMm) * 100}%`,
              width: `${(element.widthMm / plate.size.widthMm) * 100}%`,
              height: `${(element.heightMm / plate.size.heightMm) * 100}%`,
              transform: `rotate(${element.rotationDeg}deg)`,
            };
            if (element.kind === "rectangle") {
              return (
                <div
                  aria-hidden="true"
                  className="canvas-shape"
                  key={element.id}
                  style={{
                    ...frameStyle,
                    background: element.filled ? "#8f8a80" : "transparent",
                    border: element.filled
                      ? 0
                      : `${element.strokeWidthMm}px solid #8f8a80`,
                    borderRadius: `${element.cornerRadiusMm}px`,
                  }}
                />
              );
            }
            const label =
              element.kind === "image"
                ? "Image element"
                : `Text element: ${element.kind === "text" ? element.text : "code"}`;
            return (
              <button
                aria-label={label}
                className={`canvas-element ${element.kind === "image" ? "canvas-image" : "canvas-text"} ${isSelected ? "selected" : ""}`}
                key={element.id}
                onClick={() => onSelectElement(element.id)}
                onFocus={() => onSelectElement(element.id)}
                onKeyDown={(event) => moveWithKeyboard(event, element)}
                onPointerDown={(event) => startMove(event, element)}
                style={{
                  ...frameStyle,
                  ...(element.kind === "text"
                    ? {
                        fontSize: `${Math.max(10, element.fontSizePt * canvasScale * 0.25)}px`,
                        fontWeight: element.fontWeight,
                        justifyContent:
                          element.align === "left"
                            ? "flex-start"
                            : element.align === "right"
                              ? "flex-end"
                              : "center",
                      }
                    : {}),
                }}
                type="button"
              >
                {element.kind === "image" ? (
                  <img
                    alt=""
                    draggable={false}
                    src={element.source}
                    style={{
                      objectFit:
                        element.fit === "stretch" ? "fill" : element.fit,
                    }}
                  />
                ) : element.kind === "text" ? (
                  <span>{element.text}</span>
                ) : null}
                {isSelected && <SelectionHandles />}
              </button>
            );
          })}
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
