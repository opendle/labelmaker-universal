import { use } from "react";

import type { DrawingImageResult } from "./drawing-image.js";
import { loadIconCatalog } from "./icon-catalog.js";
import { drawingResultFromIcon } from "./icon-image.js";
import { IconLibraryDialog } from "./IconLibraryDialog.js";

const catalogPromise = loadIconCatalog();

export function IconLibraryControl({
  onAdd,
  onClose,
  onError,
}: {
  readonly onAdd: (result: DrawingImageResult) => string | undefined;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  const icons = use(catalogPromise);
  return (
    <IconLibraryDialog
      icons={icons}
      onAdd={(name) => {
        onClose();
        void drawingResultFromIcon(name)
          .then((result) => {
            if (!result) throw new Error("The icon has no visible pixels.");
            onAdd(result);
          })
          .catch(onError);
      }}
      onClose={onClose}
    />
  );
}
