import type { LabelElement, LabelPlate } from "@labelmaker/domain";
import {
  ChevronDown,
  Circle,
  Flag,
  FlipHorizontal2,
  Image as ImageIcon,
  Minus,
  Pencil,
  Smile,
  Square,
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
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { CanvasElementView } from "./CanvasElementView.js";
import { CanvasGrid, CanvasRulers } from "./CanvasGuides.js";
import { IconButton } from "./controls.js";
import { clamp, isFlagPlate, MAX_ZOOM, MIN_ZOOM } from "./editor-operations.js";
import { PlateToolbarSettings } from "./Inspector.js";
import {
  printableMarginPercent,
  type PrintableMargins,
} from "./label-layout.js";
import { useCanvasInteractions } from "./useCanvasInteractions.js";
import type { HostPlatform } from "./host.js";

type WorkSurfaceStyle = CSSProperties & Record<`--${string}`, string | number>;

function suppressPointerFocusRing(event: ReactPointerEvent<HTMLButtonElement>) {
  event.currentTarget.dataset.focusRingSuppressed = "true";
}

function clearPointerFocusRingSuppression(
  event:
    | ReactFocusEvent<HTMLButtonElement>
    | ReactKeyboardEvent<HTMLButtonElement>,
) {
  delete event.currentTarget.dataset.focusRingSuppressed;
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
        onClick={() => onZoom(clamp(zoom - 10, MIN_ZOOM, MAX_ZOOM))}
      >
        <ZoomOut size={15} />
      </IconButton>
      <span>{zoom}%</span>
      <IconButton
        label="Zoom in"
        onClick={() => onZoom(clamp(zoom + 10, MIN_ZOOM, MAX_ZOOM))}
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
  onDraw,
  onOpenIcons,
  onAddShape,
  onAddSpecial,
  onUpdatePlate,
  onTrim,
  platform,
}: {
  readonly plate: LabelPlate;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onDraw: () => void;
  readonly onOpenIcons: () => void;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
  readonly platform: HostPlatform;
}) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const shapeControlRef = useRef<HTMLDivElement>(null);
  const shapeMenuRef = useRef<HTMLDivElement>(null);
  const shapeTriggerRef = useRef<HTMLButtonElement>(null);
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [shapeMenuPosition, setShapeMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  useEffect(() => {
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !shapeControlRef.current?.contains(target) &&
        !shapeMenuRef.current?.contains(target)
      ) {
        setShapeMenuOpen(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        onDocumentPointerDown,
      );
  }, []);
  const shapeOptions = [
    ["line", "Line", Minus],
    ["rectangle", "Rectangle", Square],
    ["circle", "Circle", Circle],
  ] as const;
  const onShapeMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    );
    const index = items.indexOf(
      globalThis.document.activeElement as HTMLButtonElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      setShapeMenuOpen(false);
      shapeTriggerRef.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1)?.focus();
    }
  };
  return (
    <div className="editor-toolbar">
      <div className="editor-tools">
        <button
          className="tool-button"
          onBlur={clearPointerFocusRingSuppression}
          onClick={onAddText}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <Type size={17} /> Text
        </button>
        <button
          className="tool-button"
          onClick={() => imageInputRef.current?.click()}
          onBlur={clearPointerFocusRingSuppression}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <ImageIcon size={17} /> Image
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
        <button
          className="tool-button"
          onBlur={clearPointerFocusRingSuppression}
          onClick={onDraw}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <Pencil size={17} /> Draw
        </button>
        <button
          className="tool-button"
          onBlur={clearPointerFocusRingSuppression}
          onClick={onOpenIcons}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <Smile size={17} /> Icons
        </button>
        <div className="shape-control" ref={shapeControlRef}>
          <button
            aria-expanded={shapeMenuOpen}
            aria-haspopup="menu"
            className="tool-button"
            onBlur={clearPointerFocusRingSuppression}
            onClick={(event) => {
              const nextOpen = !shapeMenuOpen;
              if (nextOpen) {
                const bounds = event.currentTarget.getBoundingClientRect();
                const menuWidth = platform === "ipados" ? 160 : 132;
                setShapeMenuPosition({
                  left: Math.max(
                    8,
                    Math.min(
                      bounds.left,
                      globalThis.innerWidth - menuWidth - 8,
                    ),
                  ),
                  top: bounds.bottom + 2,
                });
              }
              setShapeMenuOpen(nextOpen);
              if (nextOpen) {
                const showFocusRing = event.detail === 0;
                globalThis.requestAnimationFrame(() => {
                  const firstItem =
                    shapeMenuRef.current?.querySelector<HTMLElement>(
                      '[role="menuitem"]',
                    );
                  if (!firstItem) return;
                  if (!showFocusRing) {
                    firstItem.dataset.focusRingSuppressed = "true";
                  }
                  firstItem.focus();
                });
              }
            }}
            onKeyDown={clearPointerFocusRingSuppression}
            onPointerDown={suppressPointerFocusRing}
            ref={shapeTriggerRef}
            type="button"
          >
            <Square size={16} /> Shapes <ChevronDown size={13} />
          </button>
          {shapeMenuOpen &&
            createPortal(
              <div
                aria-label="Add shape"
                className={`shape-menu${platform === "ipados" ? " shape-menu-ipados" : ""}`}
                onKeyDown={onShapeMenuKeyDown}
                ref={shapeMenuRef}
                role="menu"
                style={shapeMenuPosition}
                tabIndex={-1}
              >
                {shapeOptions.map(([shape, label, Icon]) => (
                  <button
                    key={shape}
                    onBlur={clearPointerFocusRingSuppression}
                    onClick={() => {
                      onAddShape(shape);
                      setShapeMenuOpen(false);
                    }}
                    onKeyDown={clearPointerFocusRingSuppression}
                    onPointerDown={suppressPointerFocusRing}
                    role="menuitem"
                    type="button"
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>,
              globalThis.document.body,
            )}
        </div>
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
  onDraw,
  onOpenIcons,
  onAddShape,
  onAddSpecial,
  onSelectElement,
  onEditImage,
  onChangeElement,
  onUpdatePlate,
  onTrim,
  onZoom,
  printableMargins,
  platform,
}: {
  readonly plate: LabelPlate;
  readonly selectedElementId: string | null;
  readonly zoom: number;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onDraw: () => void;
  readonly onOpenIcons: () => void;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onSelectElement: (id: string | null) => void;
  readonly onEditImage: (
    image: Extract<LabelElement, { kind: "image" }>,
  ) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onTrim: () => void;
  readonly onZoom: (zoom: number) => void;
  readonly printableMargins: PrintableMargins;
  readonly platform: HostPlatform;
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
    trackTouchPointer,
  } = useCanvasInteractions({
    editingElementId,
    onChangeElement,
    onSelectElement,
    plate,
    printableMargins,
    selectedElementId,
    touchNavigation: platform === "ipados",
    zoom,
    onZoom,
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
        onDraw={onDraw}
        onOpenIcons={onOpenIcons}
        onAddShape={onAddShape}
        onAddSpecial={onAddSpecial}
        onAddText={onAddText}
        onTrim={onTrim}
        onUpdatePlate={onUpdatePlate}
        plate={plate}
        platform={platform}
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
          const touchGestureStarted = trackTouchPointer(event);
          const target = event.target as HTMLElement;
          if (
            !target.closest(".canvas-element, .zoom-control, button") ||
            target.closest(".canvas-clear-selection")
          ) {
            setEditingElementId(null);
            onSelectElement(null);
            if (!touchGestureStarted) startPan(event);
          }
        }}
        onWheel={(event) => {
          event.preventDefault();
          onZoom(
            clamp(zoom + (event.deltaY < 0 ? 10 : -10), MIN_ZOOM, MAX_ZOOM),
          );
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
            printableMargins={printableMargins}
            widthMm={plate.size.widthMm}
            zoom={zoom}
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
                  if (target.kind === "image") onEditImage(target);
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
        <CanvasZoomControl onZoom={onZoom} zoom={zoom} />
      </div>
    </main>
  );
}
