import { Check, CircleAlert, Info } from "lucide-react";
import { useCallback } from "react";

import { AddPrinterDialog, PreviewDialog } from "./AppDialogs.js";
import { AppHeader } from "./AppHeader.js";
import { replaceElement, replacePlate } from "./app-state.js";
import { EditorCanvas } from "./EditorCanvas.js";
import { trimPlate } from "./editor-operations.js";
import type { LabelmakerHost } from "./host.js";
import { Inspector } from "./Inspector.js";
import { LeftRail } from "./LeftRail.js";
import { PlateStrip } from "./PlateStrip.js";
import { useLabelmakerController } from "./useLabelmakerController.js";

export function LabelmakerApp({ host }: { readonly host: LabelmakerHost }) {
  const controller = useLabelmakerController(host);
  const { state, activePlate, selectedText, selectedImage, dispatch } =
    controller;
  const closeAddPrinter = useCallback(
    () => dispatch({ type: "close-add-printer" }),
    [dispatch],
  );
  const closePreview = useCallback(
    () => dispatch({ type: "close-preview" }),
    [dispatch],
  );

  if (!activePlate) return null;
  const saveState = state.dirty
    ? "Edited"
    : state.savedAt
      ? "Saved just now"
      : state.workspaceFileName
        ? "Saved"
        : "Not saved";

  return (
    <div className="app-shell">
      <div className="application-content">
        <AppHeader
          canPrint={controller.canPrint}
          canRedo={state.future.length > 0}
          canUndo={state.past.length > 0}
          onPreview={() => dispatch({ type: "open-preview" })}
          onPrint={(all) => void controller.print(all)}
          onPrintMenuChange={(open) =>
            dispatch({ type: "set-print-menu", open })
          }
          onRedo={() => dispatch({ type: "redo" })}
          onSave={() => void controller.save(false)}
          onUndo={() => dispatch({ type: "undo" })}
          plateCount={state.workspace.plates.length}
          platform={host.platform}
          printMenuOpen={state.printMenuOpen}
          saveState={saveState}
          workspaceName={state.workspace.name}
        />
        <div className="desktop-body">
          <LeftRail
            activePrinterId={state.activePrinterId}
            onAddPrinter={() => void controller.startDiscovery()}
            onNew={() => void controller.newWorkspace()}
            onOpen={() => void controller.openWorkspace()}
            onSaveAs={() => void controller.save(true)}
            onSelectPrinter={(printerId) =>
              dispatch({ type: "set-active-printer", printerId })
            }
            printers={state.printers}
          />
          <EditorCanvas
            onAddImage={controller.addImage}
            onAddSpecial={controller.addSpecial}
            onAddText={controller.addText}
            onMoveElement={(id, xMm, yMm) =>
              controller.editWorkspace(
                replaceElement(
                  state.workspace,
                  activePlate.id,
                  id,
                  (element) => ({ ...element, xMm, yMm }),
                ),
              )
            }
            onSelectElement={(elementId) =>
              dispatch({ type: "select-element", elementId })
            }
            onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
            plate={activePlate}
            selectedElementId={state.selectedElementId}
            zoom={state.zoom}
          />
          <Inspector
            onClearSelection={() =>
              dispatch({ type: "select-element", elementId: null })
            }
            onTrim={() =>
              controller.editWorkspace(
                trimPlate(state.workspace, activePlate.id),
              )
            }
            onUpdateImage={(image) =>
              controller.editWorkspace(
                replaceElement(
                  state.workspace,
                  activePlate.id,
                  image.id,
                  () => image,
                ),
              )
            }
            onUpdatePlate={(plate) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, () => plate),
              )
            }
            onUpdateText={(text) =>
              controller.editWorkspace(
                replaceElement(
                  state.workspace,
                  activePlate.id,
                  text.id,
                  () => text,
                ),
              )
            }
            plate={activePlate}
            selectedImage={selectedImage}
            selectedText={selectedText}
          />
        </div>
        <PlateStrip
          activePlateId={state.activePlateId}
          onAddPlate={controller.addPlate}
          onSelectPlate={(plateId, elementId) =>
            dispatch({ type: "select-plate", plateId, elementId })
          }
          workspace={state.workspace}
        />
      </div>
      <AddPrinterDialog
        discovered={state.discovered}
        discovering={state.discovering}
        onAdd={(id) => void controller.addPrinter(id)}
        onClose={closeAddPrinter}
        onSearch={() => void controller.startDiscovery()}
        open={state.addPrinterOpen}
      />
      <PreviewDialog
        canPrint={controller.canPrint}
        onClose={closePreview}
        onPrint={() => {
          closePreview();
          void controller.print(false);
        }}
        open={state.previewOpen}
        plate={activePlate}
      />
      {state.toast && (
        <output aria-live="polite" className={`toast ${state.toast.tone}`}>
          {state.toast.busy ? (
            <span aria-hidden="true" className="mini-spinner" />
          ) : state.toast.tone === "success" ? (
            <Check size={17} />
          ) : state.toast.tone === "error" ? (
            <CircleAlert size={17} />
          ) : (
            <Info size={17} />
          )}{" "}
          {state.toast.message}
        </output>
      )}
    </div>
  );
}
