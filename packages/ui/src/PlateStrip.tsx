import type { LabelDocument } from "@labelmaker/domain";
import { Plus } from "lucide-react";

import { containerFontSize, printableMarginPercent } from "./label-layout.js";

export function PlateStrip({
  workspace,
  activePlateId,
  onSelectPlate,
  onAddPlate,
  verticalMarginMm,
}: {
  readonly workspace: LabelDocument;
  readonly activePlateId: string;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly onAddPlate: () => void;
  readonly verticalMarginMm: number;
}) {
  return (
    <footer className="plate-strip">
      <div className="strip-heading">
        <span>LABELS</span>
        <small>{workspace.plates.length} labels</small>
      </div>
      <div className="plate-thumbnails">
        {workspace.plates.map((plate, index) => {
          const marginPercent = printableMarginPercent(
            verticalMarginMm,
            plate.size.heightMm,
          );
          return (
            <button
              className={`plate-thumb ${plate.id === activePlateId ? "selected" : ""}`}
              key={plate.id}
              onClick={() => onSelectPlate(plate.id, null)}
              type="button"
            >
              <span className="plate-number">{index + 1}</span>
              <span
                className="mini-label"
                style={{
                  aspectRatio: `${plate.size.widthMm}/${plate.size.heightMm}`,
                }}
              >
                {plate.elements.map((element) => {
                  const frame = {
                    left: `${(element.xMm / plate.size.widthMm) * 100}%`,
                    top: `${(element.yMm / plate.size.heightMm) * 100}%`,
                    width: `${(element.widthMm / plate.size.widthMm) * 100}%`,
                    height: `${(element.heightMm / plate.size.heightMm) * 100}%`,
                    transform: `rotate(${element.rotationDeg}deg)`,
                  };
                  if (element.kind === "text") {
                    return (
                      <span
                        className="mini-label-text"
                        key={element.id}
                        style={{
                          ...frame,
                          fontFamily: element.fontFamily,
                          fontSize: containerFontSize(
                            element.fontSizePt,
                            plate.size.widthMm,
                          ),
                          fontStyle: element.fontStyle ?? "normal",
                          fontWeight: element.fontWeight,
                          textAlign: element.align,
                        }}
                      >
                        {element.text}
                      </span>
                    );
                  }
                  if (element.kind === "image") {
                    return (
                      <img
                        alt=""
                        className={`mini-label-image fit-${element.fit}`}
                        key={element.id}
                        src={element.source}
                        style={frame}
                      />
                    );
                  }
                  if (element.kind === "rectangle") {
                    return (
                      <span
                        aria-hidden="true"
                        className={`mini-label-shape ${element.filled ? "filled" : "outlined"}`}
                        key={element.id}
                        style={frame}
                      />
                    );
                  }
                  return null;
                })}
                <span
                  aria-hidden="true"
                  className="mini-nonprintable top"
                  style={{ height: `${marginPercent}%` }}
                />
                <span
                  aria-hidden="true"
                  className="mini-nonprintable bottom"
                  style={{ height: `${marginPercent}%` }}
                />
              </span>
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
