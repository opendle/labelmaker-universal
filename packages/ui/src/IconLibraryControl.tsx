import type { DrawingImageResult } from "./drawing-image.js";
import { drawingResultFromIcon, type IconName } from "./icon-image.js";
import { IconLibraryDialog } from "./IconLibraryDialog.js";

export function IconLibraryControl({
  onAdd,
  onClose,
  onError,
}: {
  readonly onAdd: (result: DrawingImageResult) => string | undefined;
  readonly onClose: () => void;
  readonly onError: () => void;
}) {
  return (
    <IconLibraryDialog
      onAdd={(name: IconName) => {
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
