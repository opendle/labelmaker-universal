import type {
  ImageElement,
  LabelDocument,
  TextElement,
} from "@labelmaker/domain";
import { Image as ImageIcon, Plus } from "lucide-react";

export function PlateStrip({
  workspace,
  activePlateId,
  onSelectPlate,
  onAddPlate,
}: {
  readonly workspace: LabelDocument;
  readonly activePlateId: string;
  readonly onSelectPlate: (plateId: string, elementId: string | null) => void;
  readonly onAddPlate: () => void;
}) {
  return (
    <footer className="plate-strip">
      <div className="strip-heading">
        <span>PLATES</span>
        <small>{workspace.plates.length} labels</small>
      </div>
      <div className="plate-thumbnails">
        {workspace.plates.map((plate, index) => {
          const text = plate.elements.find(
            (element) => element.kind === "text",
          ) as TextElement | undefined;
          const image = plate.elements.find(
            (element) => element.kind === "image",
          ) as ImageElement | undefined;
          return (
            <button
              className={`plate-thumb ${plate.id === activePlateId ? "selected" : ""}`}
              key={plate.id}
              onClick={() =>
                onSelectPlate(plate.id, plate.elements[0]?.id ?? null)
              }
              type="button"
            >
              <span className="plate-number">{index + 1}</span>
              <span
                className="mini-label"
                style={{
                  aspectRatio: `${plate.size.widthMm}/${plate.size.heightMm}`,
                }}
              >
                {text?.text ?? (image ? <ImageIcon size={14} /> : "")}
              </span>
              <span className="thumb-name">{plate.name}</span>
            </button>
          );
        })}
        <button
          aria-label="Add plate"
          className="add-plate"
          onClick={onAddPlate}
          type="button"
        >
          <Plus size={25} />
          <span>New plate</span>
        </button>
      </div>
    </footer>
  );
}
