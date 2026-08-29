import type { LabelDocument } from "@labelmaker/domain";
import { Plus, Trash2 } from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";

import { LabelArtwork } from "./LabelArtwork.js";
import { nonPrintableMarginsMm } from "./label-layout.js";

const THUMBNAIL_PIXELS_PER_MM = 3.25;

export function PlateStrip({
  workspace,
  activePlateId,
  onSelectPlate,
  onAddPlate,
  onDeletePlate,
  printHeadSizeMm,
  marginTopMm,
  marginBottomMm,
}: {
  readonly workspace: LabelDocument;
  readonly activePlateId: string;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly onAddPlate: () => void;
  readonly onDeletePlate: (plateId: string) => void;
  readonly printHeadSizeMm: number | undefined;
  readonly marginTopMm: number | undefined;
  readonly marginBottomMm: number | undefined;
}) {
  const keyboardDeleteEnabledRef = useRef(false);
  const stripRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const updateKeyboardDelete = (event: PointerEvent) => {
      const target = event.target;
      keyboardDeleteEnabledRef.current =
        target instanceof Element &&
        Boolean(target.closest(".plate-thumb-select")) &&
        Boolean(stripRef.current?.contains(target));
    };
    globalThis.document.addEventListener("pointerdown", updateKeyboardDelete);
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        updateKeyboardDelete,
      );
  }, []);

  return (
    <footer aria-label="Labels" className="plate-strip" ref={stripRef}>
      <div className="plate-thumbnails">
        {workspace.plates.map((plate, index) => {
          return (
            <div
              className={`plate-thumb ${plate.id === activePlateId ? "selected" : ""}`}
              key={plate.id}
              style={
                {
                  "--label-preview-height": `${plate.size.heightMm * THUMBNAIL_PIXELS_PER_MM}px`,
                  "--label-preview-width": `${plate.size.widthMm * THUMBNAIL_PIXELS_PER_MM}px`,
                } as CSSProperties & Record<`--${string}`, string>
              }
            >
              <button
                aria-label={`Select label ${index + 1}: ${plate.name}`}
                aria-keyshortcuts="Delete Backspace"
                className="plate-thumb-select"
                onClick={() => {
                  keyboardDeleteEnabledRef.current = true;
                  onSelectPlate(plate.id, null);
                }}
                onKeyDown={(event) => {
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
                <span className="thumb-name">{plate.name}</span>
              </button>
              <button
                aria-label={`Delete label ${plate.name}`}
                className="plate-delete"
                disabled={workspace.plates.length === 1}
                onClick={() => onDeletePlate(plate.id)}
                title={
                  workspace.plates.length === 1
                    ? "A workspace must contain one label"
                    : `Delete ${plate.name}`
                }
                type="button"
              >
                <Trash2 size={12} />
              </button>
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
