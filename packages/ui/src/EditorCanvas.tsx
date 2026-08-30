import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
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
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { CanvasElementView } from "./CanvasElementView.js";
import { CanvasGrid, CanvasRulers } from "./CanvasGuides.js";
import { clamp, isFlagPlate, MAX_ZOOM, MIN_ZOOM } from "./editor-operations.js";
import {
  clearImageFileInputMarker,
  openImageFileInput,
} from "./image-file-input.js";
import { PhoneEditorToolbar } from "./PhoneEditorToolbar.js";
import { PlateToolbarSettings } from "./Inspector.js";
import {
  printableMarginPercent,
  type PrintableMargins,
} from "./label-layout.js";
import { useCanvasInteractions } from "./useCanvasInteractions.js";
import type { HostPlatform, HostPresentation } from "./host.js";
import type { ResponsiveLayout } from "./useResponsiveLayout.js";

type WorkSurfaceStyle = CSSProperties & Record<`--${string}`, string | number>;

function useElementSize(ref: React.RefObject<HTMLElement | null>) {
  const sizeRef = useRef<
    { readonly width: number; readonly height: number } | undefined
  >(undefined);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const element = ref.current;
      if (!element) return () => undefined;
      const update = () => {
        const bounds = element.getBoundingClientRect();
        const current = sizeRef.current;
        if (
          current?.width === bounds.width &&
          current.height === bounds.height
        ) {
          return;
        }
        sizeRef.current = { width: bounds.width, height: bounds.height };
        onStoreChange();
      };
      update();
      if (typeof ResizeObserver === "undefined") {
        globalThis.addEventListener("resize", update);
        return () => globalThis.removeEventListener("resize", update);
      }
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [ref],
  );
  const getSnapshot = useCallback(() => sizeRef.current, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

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
  presentation,
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
  readonly presentation: HostPresentation;
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
          <Type size={17} /> <span className="tool-button-label">Text</span>
        </button>
        <button
          className="tool-button"
          onClick={() => openImageFileInput(imageInputRef.current)}
          onBlur={clearPointerFocusRingSuppression}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <ImageIcon size={17} />
          <span className="tool-button-label">Image</span>
        </button>
        <input
          ref={imageInputRef}
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          aria-label="Choose image"
          className="file-input"
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) onAddImage(file);
            clearImageFileInputMarker(event.target);
            event.target.value = "";
          }}
          type="file"
        />
        <button
          className="tool-button"
          onBlur={clearPointerFocusRingSuppression}
          onClick={onOpenIcons}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <Smile size={17} /> <span className="tool-button-label">Icons</span>
        </button>
        <button
          className="tool-button"
          onBlur={clearPointerFocusRingSuppression}
          onClick={onDraw}
          onKeyDown={clearPointerFocusRingSuppression}
          onPointerDown={suppressPointerFocusRing}
          type="button"
        >
          <Pencil size={17} /> <span className="tool-button-label">Draw</span>
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
                const menuWidth = presentation === "mobile-touch" ? 160 : 132;
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
            <Square size={16} />
            <span className="tool-button-label">Shapes</span>
            <ChevronDown className="tool-button-disclosure" size={13} />
          </button>
          {shapeMenuOpen &&
            createPortal(
              <div
                aria-label="Add shape"
                className={`shape-menu${presentation === "mobile-touch" ? " shape-menu-mobile-touch" : ""}`}
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
          <Flag size={16} /> <span className="tool-button-label">Flag</span>
        </button>
        <button
          aria-pressed={plate.mirrorPrint === true}
          className={`tool-button${plate.mirrorPrint ? " active" : ""}`}
          onClick={() =>
            onUpdatePlate({ ...plate, mirrorPrint: !plate.mirrorPrint })
          }
          type="button"
        >
          <FlipHorizontal2 size={16} />
          <span className="tool-button-label">Mirror</span>
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
  presentation,
  layout,
  selectedText,
  selectedImage,
  selectedShape,
  onDeleteSelection,
  onOpenElementProperties,
  onOpenPlateSettings,
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
  readonly presentation: HostPresentation;
  readonly layout: ResponsiveLayout;
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly selectedShape: ShapeElement | undefined;
  readonly onDeleteSelection: () => void;
  readonly onOpenElementProperties: () => void;
  readonly onOpenPlateSettings: () => void;
}) {
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const workSurfaceRef = useRef<HTMLDivElement>(null);
  const workSurfaceSize = useElementSize(workSurfaceRef);
  useCommitInlineEdit(editingElementId, setEditingElementId);
  const phoneLayout = layout !== "standard";
  const fallbackPhoneWidth = Math.max(1, globalThis.innerWidth - 84);
  const fallbackPhoneHeight = Math.max(1, globalThis.innerHeight - 210);
  const availableWidth =
    workSurfaceSize && workSurfaceSize.width > 0
      ? workSurfaceSize.width - 84
      : fallbackPhoneWidth;
  const availableHeight =
    workSurfaceSize && workSurfaceSize.height > 0
      ? workSurfaceSize.height - 80
      : fallbackPhoneHeight;
  const baseCanvasScale = phoneLayout
    ? Math.max(
        0.01,
        Math.min(
          9,
          availableWidth / plate.size.widthMm,
          availableHeight / plate.size.heightMm,
        ),
      )
    : Math.min(9, 720 / plate.size.widthMm);
  const canvasScale = baseCanvasScale * (zoom / 100);
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
    touchNavigation: presentation === "mobile-touch",
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
      {phoneLayout ? (
        <PhoneEditorToolbar
          onAddImage={onAddImage}
          onAddShape={onAddShape}
          onAddText={onAddText}
          onChangeElement={onChangeElement}
          onDeleteSelection={onDeleteSelection}
          onDraw={onDraw}
          onOpenElementProperties={onOpenElementProperties}
          onOpenIcons={onOpenIcons}
          onOpenPlateSettings={onOpenPlateSettings}
          onTrim={onTrim}
          selectedImage={selectedImage}
          selectedShape={selectedShape}
          selectedText={selectedText}
        />
      ) : (
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
          presentation={presentation}
        />
      )}
      <div
        className="work-surface"
        ref={workSurfaceRef}
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
            !target.closest(".canvas-element, button") ||
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
      </div>
    </main>
  );
}
