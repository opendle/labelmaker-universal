import type { LabelDocument, LabelPlate } from "@labelmaker/domain";
import { Check, CircleAlert, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AddPrinterDialog } from "./AppDialogs.js";
import { AppHeader, type AppHeaderProps } from "./AppHeader.js";
import { movePlate, replacePlate, type Toast } from "./app-state.js";
import { EditorCanvas } from "./EditorCanvas.js";
import {
  editableElementCount,
  moveElementLayer,
  trimPlate,
  updateElementAndFlagPeer,
} from "./editor-operations.js";
import type { LabelmakerHost } from "./host.js";
import { IconLibraryControl } from "./IconLibraryControl.js";
import { Inspector } from "./Inspector.js";
import { nonPrintableMarginsMm } from "./label-layout.js";
import { PlateStrip } from "./PlateStrip.js";
import { PhoneHeader } from "./PhoneHeader.js";
import {
  PhoneElementPropertySheet,
  PhonePlatePropertySheet,
} from "./PhonePropertySheets.js";
import { PreviewDialog } from "./PreviewDialog.js";
import { PrinterSettingsDialog } from "./PrinterSettingsDialog.js";
import { useLabelmakerController } from "./useLabelmakerController.js";
import { useDrawingEditor } from "./useDrawingEditor.js";
import {
  useResponsiveLayout,
  type ResponsiveLayout,
} from "./useResponsiveLayout.js";

function AppPlateStrip({
  controller,
  layout,
}: {
  readonly controller: ReturnType<typeof useLabelmakerController>;
  readonly layout: ResponsiveLayout;
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
      phoneMode={layout !== "standard"}
      short={layout === "phone-short"}
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

function AppToast({ toast }: { readonly toast: Toast | null }) {
  if (!toast) return null;
  return (
    <output aria-live="polite" className={`toast ${toast.tone}`}>
      {toast.busy ? (
        <span aria-hidden="true" className="mini-spinner" />
      ) : toast.tone === "success" ? (
        <Check size={17} />
      ) : toast.tone === "error" ? (
        <CircleAlert size={17} />
      ) : (
        <Info size={17} />
      )}{" "}
      {toast.message}
    </output>
  );
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
  const [phoneSheet, setPhoneSheet] = useState<"element" | "plate" | null>(
    null,
  );
  const [phonePlateDraft, setPhonePlateDraft] = useState<
    LabelPlate | undefined
  >();
  const { layout, softwareKeyboardOpen } = useResponsiveLayout(host.platform);
  const closePhoneSheetDuringRender =
    phoneSheet !== null &&
    (layout === "standard" ||
      (phoneSheet === "element" &&
        !selectedText &&
        !selectedImage &&
        !selectedShape));
  if (closePhoneSheetDuringRender) setPhoneSheet(null);
  if (closePhoneSheetDuringRender && phonePlateDraft) {
    setPhonePlateDraft(undefined);
  }
  const visiblePhoneSheet = closePhoneSheetDuringRender ? null : phoneSheet;
  const drawingEditor = useDrawingEditor({
    activePlate,
    workspace: state.workspace,
    addDrawing: controller.addDrawing,
    editWorkspace: controller.editWorkspace,
  });
  useEffect(() => {
    workspaceRef.current = state.workspace;
  }, [state.workspace]);
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
  const trimActivePlate = () => {
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
  };
  const updateText = (text: NonNullable<typeof selectedText>) =>
    controller.editWorkspace(
      replacePlate(state.workspace, activePlate.id, (plate) =>
        updateElementAndFlagPeer(plate, text),
      ),
    );
  const updateImage = (image: NonNullable<typeof selectedImage>) =>
    controller.editWorkspace(
      replacePlate(state.workspace, activePlate.id, (plate) =>
        updateElementAndFlagPeer(plate, image),
      ),
    );
  const updateShape = (shape: NonNullable<typeof selectedShape>) =>
    controller.editWorkspace(
      replacePlate(state.workspace, activePlate.id, (plate) =>
        updateElementAndFlagPeer(plate, shape),
      ),
    );
  const moveLayer = (direction: "back" | "front") => {
    if (!state.selectedElementId) return;
    controller.editWorkspace(
      replacePlate(state.workspace, activePlate.id, (plate) =>
        moveElementLayer(plate, state.selectedElementId!, direction),
      ),
    );
  };
  const headerProps: AppHeaderProps = {
    activePrinterId: state.activePrinterId,
    canPrint: controller.canPrint,
    canRedo: state.future.length > 0,
    canUndo: state.past.length > 0,
    onAddPrinter: () => void controller.startDiscovery(),
    onNew: () => void controller.newWorkspace(),
    onOpen: () => void controller.openWorkspace(),
    onOpenPrinterSettings: (printerId) =>
      dispatch({ type: "open-printer-settings", printerId }),
    onPreview: () => dispatch({ type: "open-preview" }),
    onPrint: (all) => void controller.print(all),
    onPrintMenuChange: (open) => dispatch({ type: "set-print-menu", open }),
    onRedo: () => dispatch({ type: "redo" }),
    onRemovePrinter: (printerId) => void controller.removePrinter(printerId),
    onSave: () => void controller.save(false),
    onSelectPrinter: controller.selectPrinter,
    onUndo: () => dispatch({ type: "undo" }),
    plateCount: state.workspace.plates.length,
    platform: host.platform,
    printMenuOpen: state.printMenuOpen,
    printers: state.printers,
    saveState,
    workspaceName: state.workspace.name,
  };

  return (
    <div
      ref={shellRef}
      className={`app-shell platform-${host.platform} layout-${layout}`}
      data-software-keyboard={softwareKeyboardOpen ? "open" : undefined}
    >
      <div className="application-content">
        {layout === "standard" ? (
          <AppHeader {...headerProps} />
        ) : (
          <PhoneHeader {...headerProps} />
        )}
        <div className="desktop-body">
          <EditorCanvas
            layout={layout}
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
            onDeleteSelection={controller.deleteSelected}
            onOpenElementProperties={() => setPhoneSheet("element")}
            onOpenPlateSettings={() => {
              setPhonePlateDraft(activePlate);
              setPhoneSheet("plate");
            }}
            onTrim={trimActivePlate}
            onUpdatePlate={(plate) =>
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, () => plate),
              )
            }
            onZoom={(zoom) => dispatch({ type: "set-zoom", zoom })}
            platform={host.platform}
            plate={activePlate}
            selectedElementId={state.selectedElementId}
            selectedImage={selectedImage}
            selectedShape={selectedShape}
            selectedText={selectedText}
            printableMargins={printableMargins}
            zoom={state.zoom}
          />
          {layout === "standard" && (
            <Inspector
              hasMultipleElements={editableElementCount(activePlate) > 1}
              onDeleteSelection={controller.deleteSelected}
              onMoveLayer={moveLayer}
              onUpdateImage={updateImage}
              onUpdateShape={updateShape}
              onUpdateText={updateText}
              selectedImage={selectedImage}
              selectedShape={selectedShape}
              selectedText={selectedText}
            />
          )}
        </div>
        <AppPlateStrip controller={controller} layout={layout} />
      </div>
      {layout !== "standard" &&
        visiblePhoneSheet === "element" &&
        (selectedText || selectedImage || selectedShape) && (
          <PhoneElementPropertySheet
            hasMultipleElements={editableElementCount(activePlate) > 1}
            onClose={() => setPhoneSheet(null)}
            onDeleteSelection={controller.deleteSelected}
            onMoveLayer={moveLayer}
            onUpdateImage={updateImage}
            onUpdateShape={updateShape}
            onUpdateText={updateText}
            selectedImage={selectedImage}
            selectedShape={selectedShape}
            selectedText={selectedText}
          />
        )}
      {layout !== "standard" &&
        visiblePhoneSheet === "plate" &&
        phonePlateDraft && (
          <PhonePlatePropertySheet
            canDelete={state.workspace.plates.length > 1}
            draft={phonePlateDraft}
            onChange={setPhonePlateDraft}
            onClose={() => {
              setPhonePlateDraft(undefined);
              setPhoneSheet(null);
            }}
            onDelete={() => controller.deletePlate(activePlate.id)}
            onSave={(plate) => {
              if (plate === activePlate) return;
              controller.editWorkspace(
                replacePlate(state.workspace, activePlate.id, () => plate),
              );
            }}
          />
        )}
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
      )}
      <AppToast toast={state.toast} />
    </div>
  );
}
