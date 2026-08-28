import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import {
  Flag,
  FlipHorizontal2,
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
  type CSSProperties,
} from "react";

import { CanvasElementView } from "./CanvasElementView.js";
import { CanvasGrid, CanvasRulers } from "./CanvasGuides.js";
import { IconButton } from "./controls.js";
import { clamp, isFlagPlate } from "./editor-operations.js";
import { PlateToolbarSettings } from "./Inspector.js";
import {
  displayMillimeters,
  printableHeightMm,
  printableMarginPercent,
  type PrintableMargins,
} from "./label-layout.js";
import { useCanvasInteractions } from "./useCanvasInteractions.js";

type WorkSurfaceStyle = CSSProperties & Record<`--${string}`, string | number>;

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
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
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
          aria-pressed={isFlagPlate(plate)}
          className={`tool-button${isFlagPlate(plate) ? " active" : ""}`}
          onClick={() => onAddSpecial("flag")}
          type="button"
        >
          <Flag size={16} /> Flag
        </button>
        <button
          aria-pressed={plate.mirrorPrint === true}
          className={`tool-button${plate.mirrorPrint ? " active" : ""}`}
          onClick={() =>
            onUpdatePlate({ ...plate, mirrorPrint: !plate.mirrorPrint })
          }
          type="button"
        >
          <FlipHorizontal2 size={16} /> Mirror
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

function useCommitInlineEdit(
  editingElementId: string | null,
  setEditingElementId: (id: string | null) => void,
) {
  useEffect(() => {
    if (!editingElementId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const editor = target.closest<HTMLElement>(".inline-text-editor");
      if (editor?.dataset.elementId !== editingElementId) {
        setEditingElementId(null);
      }
    };
    globalThis.document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        onPointerDown,
        true,
      );
  }, [editingElementId, setEditingElementId]);
}

function NonprintableZones({
  topMarginPercent,
  bottomMarginPercent,
}: {
  topMarginPercent: number;
  bottomMarginPercent: number;
}) {
  return (
    <>
      <span
        aria-hidden="true"
        className="nonprintable-zone top"
        style={{ height: `${topMarginPercent}%` }}
      />
      <span
        aria-hidden="true"
        className="nonprintable-zone bottom"
        style={{ height: `${bottomMarginPercent}%` }}
      />
    </>
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
  printableMargins,
  printerDpi,
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
  readonly printableMargins: PrintableMargins;
  readonly printerDpi: number | undefined;
}) {
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  useCommitInlineEdit(editingElementId, setEditingElementId);
  const canvasScale = Math.min(9, 720 / plate.size.widthMm) * (zoom / 100);
  const topMarginPercent = printableMarginPercent(
    printableMargins.topMm,
    plate.size.heightMm,
  );
  const bottomMarginPercent = printableMarginPercent(
    printableMargins.bottomMm,
    plate.size.heightMm,
  );
  const {
    editOnClickRef,
    moveWithKeyboard,
    pan,
    startMove,
    startPan,
    startResize,
    startRotate,
  } = useCanvasInteractions({
    editingElementId,
    onChangeElement,
    onSelectElement,
    plate,
    printableMargins,
    selectedElementId,
  });

  useEffect(() => {
    if (!editingElementId) return;
    const editor = Array.from(
      globalThis.document.querySelectorAll<HTMLElement>(".inline-text-editor"),
    ).find((item) => item.dataset.elementId === editingElementId);
    editor?.focus();
  }, [editingElementId]);

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
        style={
          {
            "--dot-grid-size": `${canvasScale}px`,
            "--dot-grid-x": `calc(50% - ${(plate.size.widthMm * canvasScale) / 2}px + ${pan.x}px)`,
            "--dot-grid-y": `calc(50% - ${(plate.size.heightMm * canvasScale) / 2}px + ${pan.y}px)`,
          } as WorkSurfaceStyle
        }
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          if (
            !target.closest(".canvas-element, .zoom-control, button") ||
            target.closest(".canvas-clear-selection")
          ) {
            setEditingElementId(null);
            onSelectElement(null);
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
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <CanvasGrid
            canvasScale={canvasScale}
            heightMm={plate.size.heightMm}
            widthMm={plate.size.widthMm}
          />
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
            <NonprintableZones
              bottomMarginPercent={bottomMarginPercent}
              topMarginPercent={topMarginPercent}
            />
          </section>
        </div>
        <div className="canvas-meta">
          {printerDpi === undefined
            ? "Printer dpi not reported"
            : `${printerDpi} dpi`}{" "}
          · Printable area {displayMillimeters(plate.size.widthMm)} ×{" "}
          {displayMillimeters(
            printableHeightMm(plate.size.heightMm, printableMargins),
          )}{" "}
          mm
        </div>
        <CanvasZoomControl onZoom={onZoom} zoom={zoom} />
      </div>
    </main>
  );
}
