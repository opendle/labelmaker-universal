import { Check, CircleAlert, Info } from "lucide-react";
import { useCallback } from "react";

import { AddPrinterDialog } from "./AppDialogs.js";
import { AppHeader } from "./AppHeader.js";
import { replacePlate } from "./app-state.js";
import { EditorCanvas } from "./EditorCanvas.js";
import { trimPlate, updateElementAndFlagPeer } from "./editor-operations.js";
import type { LabelmakerHost } from "./host.js";
import { Inspector } from "./Inspector.js";
import { nonPrintableMarginsMm } from "./label-layout.js";
import { PlateStrip } from "./PlateStrip.js";
import { PreviewDialog } from "./PreviewDialog.js";
import { PrinterSettingsDialog } from "./PrinterSettingsDialog.js";
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
  const closePrinterSettings = useCallback(
    () => dispatch({ type: "close-printer-settings" }),
    [dispatch],
  );

  if (!activePlate) return null;
  const printableMargins = nonPrintableMarginsMm(
    activePlate.size.heightMm,
    controller.activePrinter?.printableWidthMm,
    controller.activePrinter?.marginTopMm,
    controller.activePrinter?.marginBottomMm,
  );
  const settingsPrinter = state.printers.find(
    (printer) => printer.id === state.printerSettingsId,
  );
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
          activePrinterId={state.activePrinterId}
          canPrint={controller.canPrint}
          canRedo={state.future.length > 0}
          canUndo={state.past.length > 0}
          onAddPrinter={() => void controller.startDiscovery()}
          onNew={() => void controller.newWorkspace()}
          onOpen={() => void controller.openWorkspace()}
          onOpenPrinterSettings={(printerId) =>
            dispatch({ type: "open-printer-settings", printerId })
          }
          onPreview={() => dispatch({ type: "open-preview" })}
          onPrint={(all) => void controller.print(all)}
          onPrintMenuChange={(open) =>
            dispatch({ type: "set-print-menu", open })
          }
          onRedo={() => dispatch({ type: "redo" })}
          onRemovePrinter={(printerId) =>
            void controller.removePrinter(printerId)
          }
          onSave={() => void controller.save(false)}
          onSelectPrinter={controller.selectPrinter}
          onUndo={() => dispatch({ type: "undo" })}
          plateCount={state.workspace.plates.length}
          platform={host.platform}
          printMenuOpen={state.printMenuOpen}
          printers={state.printers}
          saveState={saveState}
          workspaceName={state.workspace.name}
        />
        <div className="desktop-body">
          <EditorCanvas
            onAddImage={controller.addImage}
            onAddSpecial={controller.addSpecial}
            onAddText={controller.addText}
            onChangeElement={(element) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, (plate) =>
                  updateElementAndFlagPeer(plate, element),
                ),
              )
            }
            onSelectElement={(elementId) =>
              dispatch({ type: "select-element", elementId })
            }
            onTrim={() =>
              controller.editWorkspace(
                trimPlate(state.workspace, activePlate.id),
              )
            }
            onUpdatePlate={(plate) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, () => plate),
              )
            }
            onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
            plate={activePlate}
            printerDpi={controller.activePrinter?.dpi}
            selectedElementId={state.selectedElementId}
            printableMargins={printableMargins}
            zoom={state.zoom}
          />
          <Inspector
            onClearSelection={() =>
              dispatch({ type: "select-element", elementId: null })
            }
            onUpdateImage={(image) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, (plate) =>
                  updateElementAndFlagPeer(plate, image),
                ),
              )
            }
            onUpdateText={(text) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, (plate) =>
                  updateElementAndFlagPeer(plate, text),
                ),
              )
            }
            selectedImage={selectedImage}
            selectedText={selectedText}
          />
        </div>
        <PlateStrip
          activePlateId={state.activePlateId}
          onAddPlate={controller.addPlate}
          onDeletePlate={controller.deletePlate}
          onSelectPlate={(plateId, elementId) =>
            dispatch({ type: "select-plate", plateId, elementId })
          }
          marginBottomMm={controller.activePrinter?.marginBottomMm}
          marginTopMm={controller.activePrinter?.marginTopMm}
          printHeadSizeMm={controller.activePrinter?.printableWidthMm}
          workspace={state.workspace}
        />
      </div>
      <AddPrinterDialog
        discovered={state.discovered}
        discovering={state.discovering}
        onAdd={controller.addPrinter}
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
        printerDpi={controller.activePrinter?.dpi}
        printableMargins={printableMargins}
      />
      <PrinterSettingsDialog
        key={settingsPrinter?.id ?? "closed-printer-settings"}
        onClose={closePrinterSettings}
        onSave={controller.updatePrinterSettings}
        open={state.printerSettingsId !== null}
        printer={settingsPrinter}
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
