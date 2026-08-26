import type { LabelDocument } from "@labelmaker/domain";
import { Plus } from "lucide-react";

import { LabelArtwork } from "./LabelArtwork.js";
import { nonPrintableMarginMm } from "./label-layout.js";

export function PlateStrip({
  workspace,
  activePlateId,
  onSelectPlate,
  onAddPlate,
  printableWidthMm,
}: {
  readonly workspace: LabelDocument;
  readonly activePlateId: string;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly onAddPlate: () => void;
  readonly printableWidthMm: number | undefined;
}) {
  return (
    <footer className="plate-strip">
      <div className="strip-heading">
        <span>LABELS</span>
        <small>{workspace.plates.length} labels</small>
      </div>
      <div className="plate-thumbnails">
        {workspace.plates.map((plate, index) => {
          return (
            <button
              className={`plate-thumb ${plate.id === activePlateId ? "selected" : ""}`}
              key={plate.id}
              onClick={() => onSelectPlate(plate.id, null)}
              type="button"
            >
              <span className="plate-number">{index + 1}</span>
              <LabelArtwork
                className="mini-label"
                plate={plate}
                verticalMarginMm={nonPrintableMarginMm(
                  plate.size.heightMm,
                  printableWidthMm,
                )}
              />
              <span className="thumb-name">{plate.name}</span>
            </button>
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
