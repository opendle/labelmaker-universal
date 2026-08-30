import type { LabelDocument, LabelPlate } from "@labelmaker/domain";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
} from "react";

import { AddPrinterDialog } from "./AppDialogs.js";
import { AppHeader, type AppHeaderProps } from "./AppHeader.js";
import { movePlate, replacePlate } from "./app-state.js";
import { AppToast } from "./AppToast.js";
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
import { PrinterSettingsDialog } from "./PrinterSettingsDialog.js";
import { useLabelmakerController } from "./useLabelmakerController.js";
import { useDrawingEditor } from "./useDrawingEditor.js";
import {
  useResponsiveLayout,
  type ResponsiveLayout,
} from "./useResponsiveLayout.js";
import { useLabelmakerSystemBack } from "./useSystemBackHandler.js";

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
      rasterAlignment={activePrinter?.rasterAlignment}
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

function createHeaderProps(
  controller: ReturnType<typeof useLabelmakerController>,
  platform: LabelmakerHost["platform"],
  printerMenuOpen: boolean,
  setPrinterMenuOpen: (open: boolean) => void,
): AppHeaderProps {
  const { dispatch, state } = controller;
  return {
    activePrinterId: state.activePrinterId,
    canPrint: controller.canPrint,
    canRedo: state.future.length > 0,
    canUndo: state.past.length > 0,
    onAddPrinter: () => void controller.startDiscovery(),
    onNew: () => void controller.newWorkspace(),
    onOpen: () => void controller.openWorkspace(),
    onOpenPrinterSettings: (printerId) =>
      dispatch({ type: "open-printer-settings", printerId }),
    onPrint: (all) => void controller.print(all),
    onPrintMenuChange: (open) => dispatch({ type: "set-print-menu", open }),
    onPrinterMenuChange: setPrinterMenuOpen,
    onRedo: () => dispatch({ type: "redo" }),
    onRemovePrinter: (printerId) => void controller.removePrinter(printerId),
    onSave: () => void controller.save(false),
    onSelectPrinter: controller.selectPrinter,
    onUndo: () => dispatch({ type: "undo" }),
    plateCount: state.workspace.plates.length,
    platform,
    printMenuOpen: state.printMenuOpen,
    printerMenuOpen,
    printers: state.printers,
    saveState: state.dirty
      ? "Edited"
      : state.savedAt
        ? "Saved just now"
        : state.workspaceFileName
          ? "Saved"
          : "Not saved",
    workspaceName: state.workspace.name,
  };
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
  const [printerMenuOpen, setPrinterMenuOpen] = useState(false);
  const [phoneSheet, setPhoneSheet] = useState<"element" | "plate" | null>(
    null,
  );
  const [phonePlateDraft, setPhonePlateDraft] = useState<
    LabelPlate | undefined
  >();
  const { layout, softwareKeyboardOpen } = useResponsiveLayout(
    host.presentation,
  );
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
  const closePrinterSettings = useCallback(
    () => dispatch({ type: "close-printer-settings" }),
    [dispatch],
  );
  useLabelmakerSystemBack(host.registerSystemBackHandler, {
    drawingEditorOpen: drawingEditor.isOpen,
    closeDrawingEditor: drawingEditor.close,
    iconLibraryOpen,
    closeIconLibrary: () => setIconLibraryOpen(false),
    printerSettingsOpen: state.printerSettingsId !== null,
    closePrinterSettings,
    addPrinterOpen: state.addPrinterOpen,
    discovering: state.discovering,
    closeAddPrinter,
    phoneSheetOpen: phoneSheet !== null,
    closePhoneSheet: () => {
      setPhonePlateDraft(undefined);
      setPhoneSheet(null);
    },
    printMenuOpen: state.printMenuOpen,
    closePrintMenu: () => dispatch({ type: "set-print-menu", open: false }),
    printerMenuOpen,
    closePrinterMenu: () => setPrinterMenuOpen(false),
  });

  if (!activePlate) return null;
  const printableMargins = nonPrintableMarginsMm(
    activePlate.size.heightMm,
    controller.activePrinter?.printableWidthMm,
    controller.activePrinter?.marginTopMm,
    controller.activePrinter?.marginBottomMm,
    controller.activePrinter?.rasterAlignment,
  );
  const settingsPrinter = state.printers.find(
    (printer) => printer.id === state.printerSettingsId,
  );
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
  const headerProps = createHeaderProps(
    controller,
    host.platform,
    printerMenuOpen,
    setPrinterMenuOpen,
  );

  return (
    <div
      ref={shellRef}
      className={`app-shell platform-${host.platform} presentation-${host.presentation} layout-${layout}`}
      data-software-keyboard={softwareKeyboardOpen ? "open" : undefined}
      onFocusCapture={(event: FocusEvent<HTMLDivElement>) => {
        if (host.presentation !== "mobile-touch") return;
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.type !== "number") {
          return;
        }
        input.select();
        globalThis.requestAnimationFrame(() => {
          if (globalThis.document.activeElement === input) input.select();
        });
      }}
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
            presentation={host.presentation}
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
      <AppToast
        {...(controller.canCancelPrint
          ? { onCancelPrint: () => void controller.cancelPrint() }
          : {})}
        toast={state.toast}
      />
    </div>
  );
}
