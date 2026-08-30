import type {
  ImageElement,
  LabelDocument,
  LabelPlate,
} from "@labelmaker/domain";
import { useCallback, useState } from "react";

import { replacePlate } from "./app-state.js";
import { DrawingEditorDialog } from "./DrawingEditorDialog.js";
import {
  type DrawingImageResult,
  frameForCroppedImage,
  frameForDrawingEditor,
  rememberDrawingEditorSource,
} from "./drawing-image.js";
import { updateElementAndFlagPeer } from "./editor-operations.js";

export function useDrawingEditor({
  activePlate,
  workspace,
  addDrawing,
  editWorkspace,
}: {
  readonly activePlate: LabelPlate | undefined;
  readonly workspace: LabelDocument;
  readonly addDrawing: (result: DrawingImageResult) => string | undefined;
  readonly editWorkspace: (workspace: LabelDocument) => void;
}) {
  const [image, setImage] = useState<ImageElement | null | undefined>(
    undefined,
  );
  const close = useCallback(() => setImage(undefined), []);
  return {
    close,
    isOpen: image !== undefined,
    openNew: useCallback(() => setImage(null), []),
    openImage: useCallback(
      (target: ImageElement) => setImage(frameForDrawingEditor(target)),
      [],
    ),
    dialog:
      image === undefined ? null : (
        <DrawingEditorDialog
          image={image ?? undefined}
          onClose={close}
          onSave={(result) => {
            if (image) {
              if (!activePlate) {
                close();
                return;
              }
              const updatedImage = frameForCroppedImage(image, result);
              editWorkspace(
                replacePlate(workspace, activePlate.id, (plate) =>
                  updateElementAndFlagPeer(plate, updatedImage),
                ),
              );
              rememberDrawingEditorSource(
                updatedImage.id,
                updatedImage.source,
                result.editorSource,
              );
            } else {
              const elementId = addDrawing(result);
              if (elementId) {
                rememberDrawingEditorSource(
                  elementId,
                  result.source,
                  result.editorSource,
                );
              }
            }
            close();
          }}
        />
      ),
  };
}
