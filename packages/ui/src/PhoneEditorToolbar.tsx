import type {
  ImageElement,
  LabelElement,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Circle,
  Image as ImageIcon,
  Minus,
  MoreHorizontal,
  Pencil,
  Settings2,
  SlidersHorizontal,
  Smile,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import {
  clearImageFileInputMarker,
  openImageFileInput,
} from "./image-file-input.js";
import { NumberInput } from "./NumberInput.js";

type PhoneMenu = "shapes" | null;

export function PhoneEditorToolbar({
  selectedText,
  selectedImage,
  selectedShape,
  onAddText,
  onAddImage,
  onDraw,
  onOpenIcons,
  onAddShape,
  onChangeElement,
  onDeleteSelection,
  onOpenElementProperties,
  onOpenPlateSettings,
}: {
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly selectedShape: ShapeElement | undefined;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onDraw: () => void;
  readonly onOpenIcons: () => void;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly onDeleteSelection: () => void;
  readonly onOpenElementProperties: () => void;
  readonly onOpenPlateSettings: () => void;
}) {
  const selectedElement = selectedText ?? selectedImage ?? selectedShape;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PhoneMenu>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 210;
    setMenuPosition({
      left: Math.max(
        8,
        Math.min(bounds.left, globalThis.innerWidth - menuWidth - 8),
      ),
      top: bounds.bottom + 4,
    });
    menuTriggerRef.current = event.currentTarget;
    setMenu((current) => (current === "shapes" ? null : "shapes"));
  };

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onAddImage(file);
    clearImageFileInputMarker(event.target);
    event.target.value = "";
    setMenu(null);
  };

  return (
    <div
      className={`phone-editor-toolbar${selectedElement ? " has-quick-controls" : ""}`}
    >
      <input
        ref={imageInputRef}
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        aria-label="Choose image"
        className="file-input"
        onChange={selectImage}
        type="file"
      />
      <div className="phone-primary-command-row">
        <div className="phone-command-scroll">
          <PhoneToolButton
            icon={<Type size={19} />}
            label="Text"
            onClick={onAddText}
          />
          <PhoneToolButton
            icon={<ImageIcon size={19} />}
            label="Image"
            onClick={() => openImageFileInput(imageInputRef.current)}
          />
          <PhoneToolButton
            icon={<Pencil size={19} />}
            label="Draw"
            onClick={onDraw}
          />
          <PhoneToolButton
            icon={<Smile size={19} />}
            label="Icons"
            onClick={onOpenIcons}
          />
          <button
            aria-expanded={menu === "shapes"}
            aria-haspopup="menu"
            aria-label="Shapes"
            className="phone-command-button phone-shapes-button"
            onClick={openMenu}
            title="Shapes"
            type="button"
          >
            <Square size={19} /> <ChevronDown size={11} />
          </button>
        </div>
        <div className="phone-command-fixed">
          <button
            aria-label="Label settings"
            className="phone-command-icon"
            onClick={onOpenPlateSettings}
            onKeyDown={(event) => {
              delete event.currentTarget.dataset.focusRingSuppressed;
            }}
            onPointerDown={(event) => {
              event.currentTarget.dataset.focusRingSuppressed = "true";
            }}
            title="Label settings"
            type="button"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>
      {selectedElement && (
        <div className="phone-quick-command-row">
          <div className="phone-quick-scroll">
            {selectedText && (
              <TextQuickControls
                element={selectedText}
                onChange={onChangeElement}
              />
            )}
            {selectedImage && (
              <ImageQuickControls
                element={selectedImage}
                onChange={onChangeElement}
              />
            )}
            {selectedShape && (
              <ShapeQuickControls
                element={selectedShape}
                onChange={onChangeElement}
              />
            )}
          </div>
          <div className="phone-command-fixed phone-quick-fixed">
            <button
              aria-label="More element properties"
              className="phone-command-icon"
              onClick={onOpenElementProperties}
              title="More properties"
              type="button"
            >
              <MoreHorizontal size={20} />
            </button>
            <button
              aria-label="Delete selected element"
              className="phone-command-icon danger"
              onClick={onDeleteSelection}
              title="Delete selected element"
              type="button"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      )}
      {menu && (
        <PhoneEditorMenu
          onAddShape={onAddShape}
          onClose={(restoreFocus) => {
            setMenu(null);
            if (restoreFocus) menuTriggerRef.current?.focus();
          }}
          position={menuPosition}
          trigger={menuTriggerRef.current}
        />
      )}
    </div>
  );
}

function PhoneEditorMenu({
  position,
  trigger,
  onAddShape,
  onClose,
}: {
  readonly position: CSSProperties;
  readonly trigger: HTMLButtonElement | null;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onClose: (restoreFocus: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
        ?.focus();
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !trigger?.contains(target)) {
        onCloseRef.current(false);
      }
    };
    globalThis.document.addEventListener("pointerdown", closeMenu);
    return () =>
      globalThis.document.removeEventListener("pointerdown", closeMenu);
  }, [trigger]);

  const run = (action: () => void) => {
    onClose(false);
    action();
  };
  return createPortal(
    <div
      aria-label="Add shape"
      className="phone-tools-menu"
      onKeyDown={(event) => {
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"]:not([disabled])',
          ),
        );
        const index = items.indexOf(
          globalThis.document.activeElement as HTMLButtonElement,
        );
        if (event.key === "Escape") {
          event.preventDefault();
          onClose(true);
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
      }}
      ref={menuRef}
      role="menu"
      style={position}
      tabIndex={-1}
    >
      <button
        onClick={() => run(() => onAddShape("line"))}
        role="menuitem"
        type="button"
      >
        <Minus size={17} /> Line
      </button>
      <button
        onClick={() => run(() => onAddShape("rectangle"))}
        role="menuitem"
        type="button"
      >
        <Square size={17} /> Rectangle
      </button>
      <button
        onClick={() => run(() => onAddShape("circle"))}
        role="menuitem"
        type="button"
      >
        <Circle size={17} /> Circle
      </button>
    </div>,
    globalThis.document.body,
  );
}

function PhoneToolButton({
  icon,
  label,
  onClick,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="phone-command-button"
      onClick={onClick}
      title={label}
      type="button"
    >
      {icon}
    </button>
  );
}

function TextQuickControls({
  element,
  onChange,
}: {
  readonly element: TextElement;
  readonly onChange: (element: LabelElement) => void;
}) {
  const inputId = useId();
  return (
    <>
      <label className="field phone-quick-number" htmlFor={inputId}>
        <span>SIZE</span>
        <div className="unit-input">
          <NumberInput
            aria-label="Font size"
            id={inputId}
            inputMode="numeric"
            min={1}
            onValueChange={(value) =>
              onChange({
                ...element,
                fontSizePt: Math.max(1, Math.round(value)),
              })
            }
            step={1}
            value={Math.round(element.fontSizePt)}
          />
          <b>pt</b>
        </div>
      </label>
      <div
        aria-label="Horizontal text alignment"
        className="phone-quick-segmented"
      >
        {(["left", "center", "right"] as const).map((alignment) => (
          <button
            aria-label={`Align ${alignment}`}
            aria-pressed={element.align === alignment}
            className={element.align === alignment ? "active" : ""}
            key={alignment}
            onClick={() => onChange({ ...element, align: alignment })}
            type="button"
          >
            {alignment === "left" ? (
              <AlignLeft size={17} />
            ) : alignment === "center" ? (
              <AlignCenter size={17} />
            ) : (
              <AlignRight size={17} />
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function ImageQuickControls({
  element,
  onChange,
}: {
  readonly element: ImageElement;
  readonly onChange: (element: LabelElement) => void;
}) {
  return (
    <label className="phone-quick-range">
      <span>
        <SlidersHorizontal size={15} /> Contrast
      </span>
      <input
        aria-label="Image contrast"
        max={255}
        min={0}
        onChange={(event) =>
          onChange({ ...element, contrast: Number(event.target.value) })
        }
        type="range"
        value={element.contrast}
      />
    </label>
  );
}

function ShapeQuickControls({
  element,
  onChange,
}: {
  readonly element: ShapeElement;
  readonly onChange: (element: LabelElement) => void;
}) {
  const inputId = useId();
  return (
    <label
      className="field phone-quick-number phone-stroke-control"
      htmlFor={inputId}
    >
      <span>STROKE</span>
      <div className="unit-input">
        <NumberInput
          aria-label="Shape stroke width"
          id={inputId}
          inputMode="decimal"
          min={0.1}
          onValueChange={(value) =>
            onChange({
              ...element,
              strokeWidthMm: Math.max(0.1, value),
            })
          }
          step={0.1}
          value={Math.round(element.strokeWidthMm * 10) / 10}
        />
        <b>mm</b>
      </div>
    </label>
  );
}
