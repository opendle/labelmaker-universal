import type { CodeElement } from "@labelmaker/domain";
import { replacePlate } from "./app-state.js";
import { updateElementAndFlagPeer } from "./editor-operations.js";
import { nonPrintableMarginsMm } from "./label-layout.js";
import { useCodeEditor } from "./useCodeEditor.js";
import type { useLabelmakerController } from "./useLabelmakerController.js";

export function useAppCodeEditor(
  controller: ReturnType<typeof useLabelmakerController>,
) {
  const { activePlate, state, dispatch } = controller;
  const elements =
    activePlate?.elements.filter((element) =>
      state.selectedElementIds.includes(element.id),
    ) ?? [];
  const selectedElement = elements.every(
    (element) => element.kind === elements[0]?.kind,
  )
    ? elements[0]
    : undefined;
  const selectedCode =
    selectedElement?.kind === "qr" || selectedElement?.kind === "barcode"
      ? selectedElement
      : undefined;
  const codeEditor = useCodeEditor({
    activePlate,
    selectedElementIds: state.selectedElementIds,
    workspace: state.workspace,
    printableMargins: nonPrintableMarginsMm(
      activePlate?.size.heightMm ?? 16,
      controller.activePrinter?.printableWidthMm,
      controller.activePrinter?.rasterAlignment,
    ),
    editWorkspace: controller.editPrintedPixels,
    selectElement: (elementId) =>
      dispatch({ type: "select-element", elementId }),
  });
  const updateCode = (element: CodeElement) => {
    if (!activePlate) return;
    controller.editPrintedPixels(
      replacePlate(state.workspace, activePlate.id, (plate) =>
        updateElementAndFlagPeer(plate, element),
      ),
      activePlate.id,
    );
  };
  return { selectedCode, codeEditor, updateCode };
}
