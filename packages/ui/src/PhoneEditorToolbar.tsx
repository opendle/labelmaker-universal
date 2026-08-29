import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Circle,
  Crop,
  Flag,
  FlipHorizontal2,
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
  Wrench,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import { isFlagPlate } from "./editor-operations.js";

type PhoneMenu = "tools" | "shapes" | null;

export function PhoneEditorToolbar({
  plate,
  selectedText,
  selectedImage,
  selectedShape,
  onAddText,
  onAddImage,
  onDraw,
  onOpenIcons,
  onAddShape,
  onAddSpecial,
  onUpdatePlate,
  onChangeElement,
  onDeleteSelection,
  onOpenElementProperties,
  onOpenPlateSettings,
  onTrim,
}: {
  readonly plate: LabelPlate;
  readonly selectedText: TextElement | undefined;
  readonly selectedImage: ImageElement | undefined;
  readonly selectedShape: ShapeElement | undefined;
  readonly onAddText: () => void;
  readonly onAddImage: (file: File) => void;
  readonly onDraw: () => void;
  readonly onOpenIcons: () => void;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onChangeElement: (element: LabelElement) => void;
  readonly onDeleteSelection: () => void;
  readonly onOpenElementProperties: () => void;
  readonly onOpenPlateSettings: () => void;
  readonly onTrim: () => void;
}) {
  const selectedElement = selectedText ?? selectedImage ?? selectedShape;
  const imageInputRef = useRef<HTMLInputElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<PhoneMenu>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({});

  const openMenu = (
    nextMenu: Exclude<PhoneMenu, null>,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
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
    setMenu((current) => (current === nextMenu ? null : nextMenu));
  };

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onAddImage(file);
    event.target.value = "";
    setMenu(null);
  };

  return (
    <div className="phone-editor-toolbar">
      <input
        ref={imageInputRef}
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        aria-label="Choose image"
        className="file-input"
        onChange={selectImage}
        type="file"
      />
      <div className="phone-command-scroll">
        {!selectedElement ? (
          <>
            <PhoneToolButton
              icon={<Type size={17} />}
              label="Text"
              onClick={onAddText}
            />
            <PhoneToolButton
              icon={<ImageIcon size={17} />}
              label="Image"
              onClick={() => imageInputRef.current?.click()}
            />
            <PhoneToolButton
              icon={<Pencil size={17} />}
              label="Draw"
              onClick={onDraw}
            />
            <PhoneToolButton
              icon={<Smile size={17} />}
              label="Icons"
              onClick={onOpenIcons}
            />
            <button
              aria-expanded={menu === "shapes"}
              aria-haspopup="menu"
              className="phone-command-button"
              onClick={(event) => openMenu("shapes", event)}
              type="button"
            >
              <Square size={17} /> Shapes <ChevronDown size={13} />
            </button>
            <button
              aria-pressed={isFlagPlate(plate)}
              className={`phone-command-button${isFlagPlate(plate) ? " active" : ""}`}
              onClick={() => onAddSpecial("flag")}
              type="button"
            >
              <Flag size={17} /> Flag
            </button>
            <button
              aria-pressed={plate.mirrorPrint === true}
              className={`phone-command-button${plate.mirrorPrint ? " active" : ""}`}
              onClick={() =>
                onUpdatePlate({ ...plate, mirrorPrint: !plate.mirrorPrint })
              }
              type="button"
            >
              <FlipHorizontal2 size={17} /> Mirror
            </button>
          </>
        ) : (
          <>
            <button
              aria-expanded={menu === "tools"}
              aria-haspopup="menu"
              className="phone-command-button"
              onClick={(event) => openMenu("tools", event)}
              type="button"
            >
              <Wrench size={17} /> Tools <ChevronDown size={13} />
            </button>
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
          </>
        )}
      </div>
      <div className="phone-command-fixed">
        <button
          aria-label="Label settings"
          className="phone-command-icon"
          onClick={onOpenPlateSettings}
          title="Label settings"
          type="button"
        >
          <Settings2 size={18} />
        </button>
        {selectedElement && (
          <>
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
          </>
        )}
        <button
          aria-label="Trim label to content"
          className="phone-command-icon trim"
          onClick={onTrim}
          title="Trim label to content"
          type="button"
        >
          <Crop size={18} />
        </button>
      </div>
      {menu && (
        <PhoneEditorMenu
          menu={menu}
          onAddShape={onAddShape}
          onAddSpecial={onAddSpecial}
          onAddText={onAddText}
          onChooseImage={() => imageInputRef.current?.click()}
          onClose={(restoreFocus) => {
            setMenu(null);
            if (restoreFocus) menuTriggerRef.current?.focus();
          }}
          onDraw={onDraw}
          onOpenIcons={onOpenIcons}
          onOpenPlateSettings={onOpenPlateSettings}
          onUpdatePlate={onUpdatePlate}
          plate={plate}
          position={menuPosition}
          trigger={menuTriggerRef.current}
        />
      )}
    </div>
  );
}

function PhoneEditorMenu({
  menu,
  plate,
  position,
  trigger,
  onAddText,
  onChooseImage,
  onDraw,
  onOpenIcons,
  onAddShape,
  onAddSpecial,
  onUpdatePlate,
  onOpenPlateSettings,
  onClose,
}: {
  readonly menu: Exclude<PhoneMenu, null>;
  readonly plate: LabelPlate;
  readonly position: CSSProperties;
  readonly trigger: HTMLButtonElement | null;
  readonly onAddText: () => void;
  readonly onChooseImage: () => void;
  readonly onDraw: () => void;
  readonly onOpenIcons: () => void;
  readonly onAddShape: (shape: "line" | "rectangle" | "circle") => void;
  readonly onAddSpecial: (kind: "flag") => void;
  readonly onUpdatePlate: (plate: LabelPlate) => void;
  readonly onOpenPlateSettings: () => void;
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
      aria-label={menu === "tools" ? "Editor tools" : "Add shape"}
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
      {menu === "tools" && (
        <>
          <button onClick={() => run(onAddText)} role="menuitem" type="button">
            <Type size={17} /> Text
          </button>
          <button onClick={onChooseImage} role="menuitem" type="button">
            <ImageIcon size={17} /> Image
          </button>
          <button onClick={() => run(onDraw)} role="menuitem" type="button">
            <Pencil size={17} /> Draw
          </button>
          <button
            onClick={() => run(onOpenIcons)}
            role="menuitem"
            type="button"
          >
            <Smile size={17} /> Icons
          </button>
        </>
      )}
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
      {menu === "tools" && (
        <>
          <button
            aria-checked={isFlagPlate(plate)}
            onClick={() => run(() => onAddSpecial("flag"))}
            role="menuitemcheckbox"
            type="button"
          >
            <Flag size={17} /> Flag
          </button>
          <button
            aria-checked={plate.mirrorPrint === true}
            onClick={() =>
              run(() =>
                onUpdatePlate({
                  ...plate,
                  mirrorPrint: !plate.mirrorPrint,
                }),
              )
            }
            role="menuitemcheckbox"
            type="button"
          >
            <FlipHorizontal2 size={17} /> Mirror
          </button>
          <button
            onClick={() => run(onOpenPlateSettings)}
            role="menuitem"
            type="button"
          >
            <Settings2 size={17} /> Label settings
          </button>
        </>
      )}
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
    <button className="phone-command-button" onClick={onClick} type="button">
      {icon} {label}
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
  return (
    <>
      <label className="phone-quick-number">
        <span>SIZE</span>
        <input
          aria-label="Font size"
          min={1}
          onChange={(event) =>
            onChange({
              ...element,
              fontSizePt: Math.max(1, Math.round(Number(event.target.value))),
            })
          }
          step={1}
          type="number"
          value={Math.round(element.fontSizePt)}
        />
        <b>pt</b>
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
  return (
    <label className="phone-quick-number phone-stroke-control">
      <span>STROKE</span>
      <input
        aria-label="Shape stroke width"
        min={0.1}
        onChange={(event) =>
          onChange({
            ...element,
            strokeWidthMm: Math.max(0.1, Number(event.target.value)),
          })
        }
        step={0.1}
        type="number"
        value={Math.round(element.strokeWidthMm * 10) / 10}
      />
      <b>mm</b>
    </label>
  );
}
