import type { LabelDocument } from "@labelmaker/domain";
import { Check, CircleAlert, Info } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { AddPrinterDialog } from "./AppDialogs.js";
import { AppHeader } from "./AppHeader.js";
import { movePlate, replacePlate } from "./app-state.js";
import { EditorCanvas } from "./EditorCanvas.js";
import {
  editableElementCount,
  moveElementLayer,
  trimPlate,
  updateElementAndFlagPeer,
} from "./editor-operations.js";
import type { LabelmakerHost } from "./host.js";
import { Inspector } from "./Inspector.js";
import { nonPrintableMarginsMm } from "./label-layout.js";
import { PlateStrip } from "./PlateStrip.js";
import { PreviewDialog } from "./PreviewDialog.js";
import { PrinterSettingsDialog } from "./PrinterSettingsDialog.js";
import { useLabelmakerController } from "./useLabelmakerController.js";
import { useDrawingEditor } from "./useDrawingEditor.js";

const IconLibraryControl = lazy(() =>
  import("./IconLibraryControl.js").then(({ IconLibraryControl: Control }) => ({
    default: Control,
  })),
);

function AppPlateStrip({
  controller,
}: {
  readonly controller: ReturnType<typeof useLabelmakerController>;
}) {
  const { activePrinter, dispatch, state } = controller;
  return (
    <PlateStrip
      activePlateId={state.activePlateId}
      marginBottomMm={activePrinter?.marginBottomMm}
      marginTopMm={activePrinter?.marginTopMm}
      onAddPlate={controller.addPlate}
      onDeletePlate={controller.deletePlate}
      onMovePlate={(plateId, targetIndex) => {
        const workspace = movePlate(state.workspace, plateId, targetIndex);
        if (workspace !== state.workspace) controller.editWorkspace(workspace);
      }}
      onRenamePlate={(plateId, name) =>
        controller.editWorkspace(
          replacePlate(state.workspace, plateId, (plate) => ({
            ...plate,
            name,
          })),
        )
      }
      onSelectPlate={(plateId, elementId) =>
        dispatch({ type: "select-plate", plateId, elementId })
      }
      printHeadSizeMm={activePrinter?.printableWidthMm}
      workspace={state.workspace}
    />
  );
}

async function trimLatestWorkspace(
  plateId: string,
  getWorkspace: () => LabelDocument,
  applyWorkspace: (workspace: LabelDocument) => void,
): Promise<void> {
  const trimSnapshot = async () => {
    const source = getWorkspace();
    return { source, workspace: await trimPlate(source, plateId) };
  };
  const first = await trimSnapshot();
  if (getWorkspace() === first.source) {
    applyWorkspace(first.workspace);
    return;
  }
  const second = await trimSnapshot();
  if (getWorkspace() === second.source) {
    applyWorkspace(second.workspace);
    return;
  }
  const third = await trimSnapshot();
  if (getWorkspace() === third.source) {
    applyWorkspace(third.workspace);
    return;
  }
  throw new Error("The label changed while trim was running.");
}

export function LabelmakerApp({ host }: { readonly host: LabelmakerHost }) {
  const controller = useLabelmakerController(host);
  const {
    state,
    activePlate,
    selectedText,
    selectedImage,
    selectedShape,
    dispatch,
  } = controller;
  const workspaceRef = useRef(state.workspace);
  const shellRef = useRef<HTMLDivElement>(null);
  const [iconLibraryOpen, setIconLibraryOpen] = useState(false);
  const drawingEditor = useDrawingEditor({
    activePlate,
    workspace: state.workspace,
    addDrawing: controller.addDrawing,
    editWorkspace: controller.editWorkspace,
  });
  useEffect(() => {
    workspaceRef.current = state.workspace;
  }, [state.workspace]);
  useEffect(() => {
    if (host.platform !== "ipados") return;
    const viewport = globalThis.visualViewport;
    if (!viewport) return;
    const shellElement = shellRef.current;
    let unobscuredViewportHeight = viewport.height;
    let viewportWidth = globalThis.innerWidth;
    const updateViewport = () => {
      globalThis.document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${viewport.height}px`,
      );
      globalThis.document.documentElement.style.setProperty(
        "--visual-viewport-offset-top",
        `${viewport.offsetTop}px`,
      );
      const activeElement = globalThis.document.activeElement;
      const editableHasFocus =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement;
      const windowWidthChanged =
        Math.abs(globalThis.innerWidth - viewportWidth) > 1;
      if (
        !editableHasFocus ||
        windowWidthChanged ||
        viewport.height > unobscuredViewportHeight
      ) {
        unobscuredViewportHeight = viewport.height;
        viewportWidth = globalThis.innerWidth;
      }
      const softwareKeyboardOpen =
        editableHasFocus && unobscuredViewportHeight - viewport.height > 80;
      if (softwareKeyboardOpen) {
        shellElement?.setAttribute("data-software-keyboard", "open");
      } else {
        shellElement?.removeAttribute("data-software-keyboard");
      }
    };
    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport, { passive: true });
    globalThis.addEventListener("resize", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      globalThis.removeEventListener("resize", updateViewport);
      globalThis.document.documentElement.style.removeProperty(
        "--visual-viewport-height",
      );
      globalThis.document.documentElement.style.removeProperty(
        "--visual-viewport-offset-top",
      );
      shellElement?.removeAttribute("data-software-keyboard");
    };
  }, [host.platform]);
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
    <div ref={shellRef} className={`app-shell platform-${host.platform}`}>
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
            onDraw={drawingEditor.openNew}
            onOpenIcons={() => setIconLibraryOpen(true)}
            onEditImage={drawingEditor.openImage}
            onAddShape={controller.addShape}
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
            onTrim={() => {
              void trimLatestWorkspace(
                activePlate.id,
                () => workspaceRef.current,
                controller.editWorkspace,
              ).catch(() =>
                dispatch({
                  type: "set-toast",
                  toast: {
                    tone: "error",
                    message: "The label could not be trimmed.",
                  },
                }),
              );
            }}
            onUpdatePlate={(plate) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, () => plate),
              )
            }
            onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
            platform={host.platform}
            plate={activePlate}
            selectedElementId={state.selectedElementId}
            printableMargins={printableMargins}
            zoom={state.zoom}
          />
          <Inspector
            hasMultipleElements={editableElementCount(activePlate) > 1}
            onDeleteSelection={controller.deleteSelected}
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
            onUpdateShape={(shape) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, (plate) =>
                  updateElementAndFlagPeer(plate, shape),
                ),
              )
            }
            onMoveLayer={(direction) => {
              if (!state.selectedElementId) return;
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, (plate) =>
                  moveElementLayer(plate, state.selectedElementId!, direction),
                ),
              );
            }}
            selectedImage={selectedImage}
            selectedShape={selectedShape}
            selectedText={selectedText}
          />
        </div>
        <AppPlateStrip controller={controller} />
      </div>
      <AddPrinterDialog
        discovered={state.discovered}
        discoveryFailed={state.discoveryFailed}
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
      {drawingEditor.dialog}
      {iconLibraryOpen && (
        <Suspense fallback={null}>
          <IconLibraryControl
            onAdd={controller.addDrawing}
            onClose={() => setIconLibraryOpen(false)}
            onError={() =>
              dispatch({
                type: "set-toast",
                toast: {
                  tone: "error",
                  message: "The icon could not be added.",
                },
              })
            }
          />
        </Suspense>
      )}
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
