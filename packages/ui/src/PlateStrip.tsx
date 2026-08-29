import type { LabelDocument, LabelPlate } from "@labelmaker/domain";
import { Plus, Trash2 } from "lucide-react";
import {
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { LabelArtwork } from "./LabelArtwork.js";
import { nonPrintableMarginsMm } from "./label-layout.js";

const THUMBNAIL_PIXELS_PER_MM = 3.25;
const MOVE_TOLERANCE_PX = 8;
const TOUCH_REORDER_DELAY_MS = 425;

interface PressState {
  readonly plateId: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly pointerType: string;
  moved: boolean;
  touchDragReady: boolean;
}

interface DragState {
  readonly plateId: string;
  readonly pointerId: number;
  readonly sourceIndex: number;
  targetIndex: number;
}

interface RenameState {
  readonly plateId: string;
  readonly value: string;
}

function platesForDragPreview(
  plates: readonly LabelPlate[],
  plateId: string | null,
  targetIndex: number | null,
): readonly LabelPlate[] {
  if (plateId === null || targetIndex === null) return plates;
  const sourceIndex = plates.findIndex((plate) => plate.id === plateId);
  if (sourceIndex < 0 || sourceIndex === targetIndex) return plates;
  const preview = [...plates];
  const [plate] = preview.splice(sourceIndex, 1);
  if (!plate) return plates;
  preview.splice(targetIndex, 0, plate);
  return preview;
}

function PlateName({
  index,
  plate,
  rename,
  setRename,
  ignoreSuppressedClick,
  onRenamePlate,
  onSelectPlate,
  active,
  phoneMode,
}: {
  readonly index: number;
  readonly plate: LabelPlate;
  readonly rename: RenameState | null;
  readonly setRename: Dispatch<SetStateAction<RenameState | null>>;
  readonly ignoreSuppressedClick: () => boolean;
  readonly onRenamePlate: (plateId: string, name: string) => void;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly active: boolean;
  readonly phoneMode: boolean;
}) {
  const editing = rename?.plateId === plate.id;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  if (editing) {
    return (
      <input
        aria-label="Label name"
        className="thumb-name-input"
        onBlur={(event) => {
          if (event.currentTarget.value !== plate.name) {
            onRenamePlate(plate.id, event.currentTarget.value);
          }
          setRename((current) =>
            current?.plateId === plate.id ? null : current,
          );
        }}
        onChange={(event) =>
          setRename({ plateId: plate.id, value: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setRename(null);
          }
        }}
        ref={inputRef}
        value={rename.value}
      />
    );
  }

  return (
    <button
      aria-label={`Rename label ${index + 1}: ${plate.name}`}
      className="thumb-name-control"
      onClick={(event) => {
        if (ignoreSuppressedClick()) {
          event.preventDefault();
          return;
        }
        if (phoneMode && active) {
          setRename({ plateId: plate.id, value: plate.name });
        } else {
          onSelectPlate(plate.id, null);
        }
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        setRename({ plateId: plate.id, value: plate.name });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "F2") return;
        event.preventDefault();
        onSelectPlate(plate.id, null);
        setRename({ plateId: plate.id, value: plate.name });
      }}
      title="Double-click to rename"
      type="button"
    >
      <span className="thumb-name">{plate.name}</span>
    </button>
  );
}

function PlateDeleteButton({
  disabled,
  name,
  onDelete,
}: {
  readonly disabled: boolean;
  readonly name: string;
  readonly onDelete: () => void;
}) {
  return (
    <button
      aria-label={`Delete label ${name}`}
      className="plate-delete"
      disabled={disabled}
      onClick={onDelete}
      title={disabled ? "A workspace must contain one label" : `Delete ${name}`}
      type="button"
    >
      <Trash2 size={12} />
    </button>
  );
}

function usePlateReorder({
  workspace,
  onMovePlate,
  onSelectPlate,
}: {
  readonly workspace: LabelDocument;
  readonly onMovePlate: (plateId: string, targetIndex: number) => void;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
}) {
  const keyboardDeleteEnabledRef = useRef(false);
  const stripRef = useRef<HTMLElement>(null);
  const pressRef = useRef<PressState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerListenerCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextClickRef = useRef(false);
  const [draggingPlateId, setDraggingPlateId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const clearPointerListeners = () => {
    pointerListenerCleanupRef.current?.();
    pointerListenerCleanupRef.current = null;
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    globalThis.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const clearDrag = () => {
    dragRef.current = null;
    setDraggingPlateId(null);
    setDropTargetIndex(null);
  };

  const finishPointer = (pointerId: number, commit: boolean) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== pointerId) return;
    clearLongPressTimer();
    const drag = dragRef.current;
    if (drag?.pointerId === pointerId) {
      if (commit && drag.targetIndex !== drag.sourceIndex) {
        onMovePlate(drag.plateId, drag.targetIndex);
      }
      clearDrag();
    }
    if (press.moved || drag) {
      suppressNextClickRef.current = true;
      globalThis.setTimeout(() => {
        suppressNextClickRef.current = false;
      });
    }
    pressRef.current = null;
  };

  const startDrag = (
    press: PressState,
    pointerTarget: HTMLDivElement,
  ): DragState | null => {
    const sourceIndex = workspace.plates.findIndex(
      (plate) => plate.id === press.plateId,
    );
    if (sourceIndex < 0) return null;
    const drag = {
      plateId: press.plateId,
      pointerId: press.pointerId,
      sourceIndex,
      targetIndex: sourceIndex,
    };
    dragRef.current = drag;
    pointerTarget.setPointerCapture?.(press.pointerId);
    setDraggingPlateId(press.plateId);
    setDropTargetIndex(sourceIndex);
    onSelectPlate(press.plateId, null);
    return drag;
  };

  const handlePointerMove = (
    event: PointerEvent,
    pointerTarget: HTMLDivElement,
  ) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - press.startX;
    const deltaY = event.clientY - press.startY;
    let drag = dragRef.current;
    if (!drag) {
      if (Math.hypot(deltaX, deltaY) <= MOVE_TOLERANCE_PX) return;
      press.moved = true;
      if (press.pointerType === "touch" && !press.touchDragReady) {
        clearLongPressTimer();
        return;
      }
      suppressNextClickRef.current = true;
      drag = startDrag(press, pointerTarget);
      if (!drag) return;
    }
    event.preventDefault();
    press.moved = true;
    const thumbnails = Array.from(
      stripRef.current?.querySelectorAll<HTMLElement>(".plate-thumb") ?? [],
    );
    if (thumbnails.length === 0) return;
    const targetIndex = thumbnails.findIndex((thumbnail) => {
      const bounds = thumbnail.getBoundingClientRect();
      return event.clientX < bounds.left + bounds.width / 2;
    });
    drag.targetIndex = targetIndex < 0 ? thumbnails.length - 1 : targetIndex;
    setDropTargetIndex(drag.targetIndex);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    plateId: string,
  ) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const target = event.target;
    if (
      target instanceof Element &&
      Boolean(target.closest(".plate-delete, .thumb-name-input"))
    ) {
      return;
    }
    clearPointerListeners();
    clearLongPressTimer();
    suppressNextClickRef.current = false;
    pressRef.current = {
      plateId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerType: event.pointerType,
      moved: false,
      touchDragReady: event.pointerType !== "touch",
    };
    const activePointerId = event.pointerId;
    const pointerTarget = event.currentTarget;
    if (event.pointerType === "touch") {
      longPressTimerRef.current = globalThis.setTimeout(() => {
        const press = pressRef.current;
        if (!press || press.pointerId !== activePointerId || press.moved)
          return;
        longPressTimerRef.current = null;
        press.touchDragReady = true;
        startDrag(press, pointerTarget);
      }, TOUCH_REORDER_DELAY_MS);
    }
    const onPointerMove = (pointerEvent: PointerEvent) =>
      handlePointerMove(pointerEvent, pointerTarget);
    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointerId) return;
      finishPointer(pointerEvent.pointerId, true);
      clearPointerListeners();
      clearLongPressTimer();
    };
    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== activePointerId) return;
      finishPointer(pointerEvent.pointerId, false);
      clearPointerListeners();
    };
    globalThis.document.addEventListener("pointermove", onPointerMove, {
      passive: false,
    });
    globalThis.document.addEventListener("pointerup", onPointerUp);
    globalThis.document.addEventListener("pointercancel", onPointerCancel);
    pointerListenerCleanupRef.current = () => {
      globalThis.document.removeEventListener("pointermove", onPointerMove);
      globalThis.document.removeEventListener("pointerup", onPointerUp);
      globalThis.document.removeEventListener("pointercancel", onPointerCancel);
    };
  };

  useEffect(() => {
    const updateKeyboardDelete = (event: PointerEvent) => {
      const target = event.target;
      keyboardDeleteEnabledRef.current =
        target instanceof Element &&
        Boolean(target.closest(".plate-thumb-select")) &&
        Boolean(stripRef.current?.contains(target));
    };
    globalThis.document.addEventListener("pointerdown", updateKeyboardDelete);
    return () => {
      globalThis.document.removeEventListener(
        "pointerdown",
        updateKeyboardDelete,
      );
      clearPointerListeners();
      clearLongPressTimer();
    };
  }, []);

  return {
    draggingPlateId,
    dropTargetIndex,
    handlePointerDown,
    ignoreSuppressedClick: () => suppressNextClickRef.current,
    keyboardDeleteEnabledRef,
    stripRef,
  };
}

export function PlateStrip({
  workspace,
  activePlateId,
  onSelectPlate,
  onAddPlate,
  onDeletePlate,
  onMovePlate,
  onRenamePlate,
  printHeadSizeMm,
  marginTopMm,
  marginBottomMm,
  phoneMode = false,
  short = false,
}: {
  readonly workspace: LabelDocument;
  readonly activePlateId: string;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly onAddPlate: () => void;
  readonly onDeletePlate: (plateId: string) => void;
  readonly onMovePlate: (plateId: string, targetIndex: number) => void;
  readonly onRenamePlate: (plateId: string, name: string) => void;
  readonly printHeadSizeMm: number | undefined;
  readonly marginTopMm: number | undefined;
  readonly marginBottomMm: number | undefined;
  readonly phoneMode?: boolean;
  readonly short?: boolean;
}) {
  const [rename, setRename] = useState<RenameState | null>(null);
  const {
    draggingPlateId,
    dropTargetIndex,
    handlePointerDown,
    ignoreSuppressedClick,
    keyboardDeleteEnabledRef,
    stripRef,
  } = usePlateReorder({ workspace, onMovePlate, onSelectPlate });
  const displayedPlates = platesForDragPreview(
    workspace.plates,
    draggingPlateId,
    dropTargetIndex,
  );

  return (
    <footer
      aria-label="Labels"
      className={`plate-strip${phoneMode ? " phone-plate-strip" : ""}${short ? " short" : ""}`}
      ref={stripRef}
    >
      <div className="plate-thumbnails">
        {displayedPlates.map((plate, index) => {
          return (
            <div
              aria-grabbed={draggingPlateId === plate.id}
              className={`plate-thumb${plate.id === activePlateId ? " selected" : ""}${draggingPlateId === plate.id ? " dragging" : ""}`}
              key={plate.id}
              onPointerDown={(event) => handlePointerDown(event, plate.id)}
              style={
                {
                  "--label-preview-height": `${plate.size.heightMm * (phoneMode ? (short ? 1.75 : 2.35) : THUMBNAIL_PIXELS_PER_MM)}px`,
                  "--label-preview-width": `${plate.size.widthMm * (phoneMode ? (short ? 1.75 : 2.35) : THUMBNAIL_PIXELS_PER_MM)}px`,
                } as CSSProperties & Record<`--${string}`, string>
              }
            >
              <button
                aria-keyshortcuts="Delete Backspace Alt+ArrowLeft Alt+ArrowRight"
                aria-label={`Select label ${index + 1}: ${plate.name}`}
                className="plate-thumb-select"
                onClick={(event) => {
                  if (ignoreSuppressedClick()) {
                    event.preventDefault();
                    return;
                  }
                  keyboardDeleteEnabledRef.current = true;
                  onSelectPlate(plate.id, null);
                }}
                onKeyDown={(event) => {
                  if (
                    event.altKey &&
                    (event.key === "ArrowLeft" || event.key === "ArrowRight")
                  ) {
                    event.preventDefault();
                    const targetIndex =
                      index + (event.key === "ArrowLeft" ? -1 : 1);
                    if (
                      targetIndex >= 0 &&
                      targetIndex < workspace.plates.length
                    ) {
                      onMovePlate(plate.id, targetIndex);
                    }
                    return;
                  }
                  if (
                    (event.key !== "Delete" && event.key !== "Backspace") ||
                    !keyboardDeleteEnabledRef.current
                  ) {
                    return;
                  }
                  event.preventDefault();
                  if (workspace.plates.length > 1) {
                    keyboardDeleteEnabledRef.current = false;
                    onDeletePlate(plate.id);
                  }
                }}
                title={phoneMode ? "Long-press to reorder" : "Drag to reorder"}
                type="button"
              >
                <span className="plate-number">{index + 1}</span>
                <LabelArtwork
                  className="mini-label"
                  plate={plate}
                  printableMargins={nonPrintableMarginsMm(
                    plate.size.heightMm,
                    printHeadSizeMm,
                    marginTopMm,
                    marginBottomMm,
                  )}
                />
              </button>
              <PlateName
                active={plate.id === activePlateId}
                ignoreSuppressedClick={ignoreSuppressedClick}
                index={index}
                onRenamePlate={onRenamePlate}
                onSelectPlate={onSelectPlate}
                phoneMode={phoneMode}
                plate={plate}
                rename={rename}
                setRename={setRename}
              />
              {!phoneMode && (
                <PlateDeleteButton
                  disabled={workspace.plates.length === 1}
                  name={plate.name}
                  onDelete={() => onDeletePlate(plate.id)}
                />
              )}
            </div>
          );
        })}
        <button
          aria-label="Add label"
          className="add-plate"
          onClick={onAddPlate}
          type="button"
        >
          <Plus size={25} />
          <span>New label</span>
        </button>
      </div>
    </footer>
  );
}
