import type {
  ImageElement,
  LabelElement,
  LabelPlate,
  ShapeElement,
  TextElement,
} from "@labelmaker/domain";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  appReducer,
  initialAppState,
  replaceElement,
  replacePlate,
  type Toast,
} from "./app-state.js";
import { trimLatestWorkspace } from "./automatic-trim.js";
import {
  appendElementAndFlagPeer,
  clamp,
  createImage,
  createPlate,
  createShape,
  createText,
  deleteElementAndFlagPeer,
  isFlagPlate,
  MAX_ZOOM,
  MIN_ZOOM,
  toggleFlagPlate,
} from "./editor-operations.js";
import {
  type DrawingEditorSource,
  type DrawingImageResult,
  drawingResultFromImageSource,
  fitNewImageFrame,
  rememberDrawingEditorSource,
} from "./drawing-image.js";
import type { LabelmakerHost, PrinterSettings } from "./host.js";
import { nonPrintableMarginsMm } from "./label-layout.js";
import {
  printerFailureMessage,
  remotePrinterFailureMessage,
} from "./printer-failure-message.js";

function toastAction(tone: Toast["tone"], message: string, busy = false) {
  return {
    type: "set-toast" as const,
    toast: { tone, message, ...(busy ? { busy: true } : {}) },
  };
}

const AUTOMATIC_TRIM_DELAY_MS = 150;

export function useLabelmakerController(host: LabelmakerHost) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [isPrinting, setIsPrinting] = useState(false);
  const printInProgress = useRef(false);
  const printCancellationRequested = useRef(false);
  const printerMutationGeneration = useRef(0);
  const workspaceRef = useRef(state.workspace);
  const automaticTrimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const automaticTrimPlateIdsRef = useRef(new Set<string>());
  const heldPrintedPixelPlateIdsRef = useRef(new Set<string>());
  const heldInteractionWaitersRef = useRef(new Set<() => void>());
  const automaticTrimGenerationRef = useRef(0);
  const automaticTrimRunRef = useRef<Promise<boolean> | null>(null);
  const automaticTrimActivePlateIdRef = useRef<string | null>(null);
  const automaticTrimRunnerRef = useRef<() => Promise<boolean>>(
    async () => true,
  );
  workspaceRef.current = state.workspace;
  const activePlate = useMemo(
    () =>
      state.workspace.plates.find((plate) => plate.id === state.activePlateId),
    [state.activePlateId, state.workspace.plates],
  );
  const selectedElement = activePlate?.elements.find(
    (element) => element.id === state.selectedElementId,
  );
  const selectedText =
    selectedElement?.kind === "text" ? selectedElement : undefined;
  const selectedImage =
    selectedElement?.kind === "image" ? selectedElement : undefined;
  const selectedShape =
    selectedElement?.kind === "rectangle" ? selectedElement : undefined;
  const activePrinter = state.printers.find(
    (printer) => printer.id === state.activePrinterId,
  );
  const insertionMargins = useCallback(
    (plate: LabelPlate) =>
      nonPrintableMarginsMm(
        plate.size.heightMm,
        activePrinter?.printableWidthMm,
        activePrinter?.marginTopMm,
        activePrinter?.marginBottomMm,
        activePrinter?.rasterAlignment,
      ),
    [activePrinter],
  );
  // The main process performs a fresh status check and reconnect before the
  // job. Keep print enabled for a configured printer so a stale renderer
  // status does not block a recoverable connection.
  const canPrint = activePrinter !== undefined && !isPrinting;
  const canCancelPrint = isPrinting && host.cancelPrint !== undefined;

  useEffect(() => {
    let active = true;
    const load = host.loadWorkspaceRecovery?.() ?? Promise.resolve(null);
    void load
      .then((recovery) => {
        if (!active) return;
        if (recovery) {
          dispatch({
            type: "restore-session",
            workspace: recovery.document,
            activePlateId: recovery.activePlateId,
            selectedElementId: recovery.selectedElementId,
            dirty: recovery.dirty,
            savedAt: recovery.savedAt,
            fileName: recovery.fileName,
            zoom: recovery.zoom,
          });
        } else {
          dispatch({ type: "recovery-ready" });
        }
      })
      .catch(() => {
        if (active) dispatch({ type: "recovery-ready" });
      });
    return () => {
      active = false;
    };
  }, [host]);

  useEffect(() => {
    if (!state.recoveryReady || !host.storeWorkspaceRecovery) return;
    void host
      .storeWorkspaceRecovery({
        document: state.workspace,
        dirty: state.dirty,
        activePlateId: state.activePlateId,
        selectedElementId: state.selectedElementId,
        zoom: state.zoom,
        savedAt: state.savedAt,
      })
      .catch(() => undefined);
  }, [
    host,
    state.activePlateId,
    state.dirty,
    state.recoveryReady,
    state.savedAt,
    state.selectedElementId,
    state.workspace,
    state.zoom,
  ]);

  useEffect(() => {
    let active = true;
    let refreshPending = false;
    const refresh = (showError: boolean, preferredId?: string | null) => {
      if (refreshPending) return;
      refreshPending = true;
      const generation = printerMutationGeneration.current;
      void host
        .listPrinters()
        .then((printers) => {
          if (active && generation === printerMutationGeneration.current)
            dispatch({
              type: "set-printers",
              printers,
              ...(preferredId ? { preferredId } : {}),
            });
        })
        .catch(() => {
          if (active && showError)
            dispatch(
              toastAction("error", "Printers could not be loaded. Try again."),
            );
        })
        .finally(() => {
          refreshPending = false;
        });
    };
    if (host.getActivePrinterId) {
      void host
        .getActivePrinterId()
        .then((preferredId) => refresh(true, preferredId))
        .catch(() => refresh(true));
    } else {
      refresh(true);
    }
    const timer = globalThis.setInterval(() => refresh(false), 5000);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [host]);

  const selectPrinter = useCallback(
    (printerId: string) => {
      dispatch({ type: "set-active-printer", printerId });
      void host.setActivePrinterId?.(printerId).catch(() => {
        dispatch(
          toastAction("error", "The printer selection could not be saved."),
        );
      });
    },
    [host],
  );

  const updatePrinterSettings = useCallback(
    async (printerId: string, settings: PrinterSettings) => {
      if (!host.updatePrinterSettings) return false;
      printerMutationGeneration.current += 1;
      try {
        const printers = await host.updatePrinterSettings(printerId, settings);
        dispatch({
          type: "set-printers",
          printers,
          ...(state.activePrinterId
            ? { preferredId: state.activePrinterId }
            : {}),
        });
        dispatch(toastAction("success", "Printer settings saved"));
        return true;
      } catch {
        dispatch(
          toastAction(
            "error",
            "Printer settings could not be saved. Try again.",
          ),
        );
        return false;
      }
    },
    [host, state.activePrinterId],
  );

  useEffect(() => {
    if (!state.toast || state.toast.busy) return;
    const durationMs = state.toast.tone === "error" ? 8000 : 6000;
    const timer = globalThis.setTimeout(
      () => dispatch({ type: "set-toast", toast: null }),
      durationMs,
    );
    return () => globalThis.clearTimeout(timer);
  }, [state.toast]);

  const runAutomaticTrim = useCallback((): Promise<boolean> => {
    const activeRun = automaticTrimRunRef.current;
    if (activeRun) return activeRun;
    const generation = automaticTrimGenerationRef.current;
    let runPromise!: Promise<boolean>;
    runPromise = (async () => {
      await Promise.resolve();
      const trimNextPlate = async (): Promise<void> => {
        if (automaticTrimGenerationRef.current !== generation) return;
        const nextPlateId = automaticTrimPlateIdsRef.current.values().next();
        if (nextPlateId.done) return;
        automaticTrimPlateIdsRef.current.delete(nextPlateId.value);
        automaticTrimActivePlateIdRef.current = nextPlateId.value;
        try {
          await trimLatestWorkspace(
            nextPlateId.value,
            () => workspaceRef.current,
            (workspace) => {
              if (automaticTrimGenerationRef.current !== generation) return;
              workspaceRef.current = workspace;
              dispatch({ type: "apply-automatic-trim", workspace });
            },
          );
        } finally {
          if (automaticTrimActivePlateIdRef.current === nextPlateId.value) {
            automaticTrimActivePlateIdRef.current = null;
          }
        }
        await trimNextPlate();
      };
      try {
        await trimNextPlate();
        return true;
      } catch {
        if (automaticTrimGenerationRef.current === generation) {
          dispatch(
            toastAction(
              "error",
              "The label could not be trimmed automatically.",
            ),
          );
        }
        return false;
      } finally {
        if (automaticTrimRunRef.current === runPromise) {
          automaticTrimRunRef.current = null;
        }
        if (
          automaticTrimPlateIdsRef.current.size > 0 &&
          heldPrintedPixelPlateIdsRef.current.size === 0 &&
          automaticTrimTimerRef.current === null
        ) {
          automaticTrimTimerRef.current = globalThis.setTimeout(() => {
            automaticTrimTimerRef.current = null;
            void automaticTrimRunnerRef.current();
          }, 0);
        }
      }
    })();
    automaticTrimRunRef.current = runPromise;
    return runPromise;
  }, []);
  automaticTrimRunnerRef.current = runAutomaticTrim;
  const scheduleAutomaticTrim = useCallback(() => {
    if (
      heldPrintedPixelPlateIdsRef.current.size > 0 ||
      automaticTrimPlateIdsRef.current.size === 0
    ) {
      return;
    }
    if (automaticTrimTimerRef.current !== null) {
      globalThis.clearTimeout(automaticTrimTimerRef.current);
    }
    automaticTrimTimerRef.current = globalThis.setTimeout(() => {
      automaticTrimTimerRef.current = null;
      void runAutomaticTrim();
    }, AUTOMATIC_TRIM_DELAY_MS);
  }, [runAutomaticTrim]);
  const requestAutomaticTrim = useCallback(
    (plateId: string) => {
      automaticTrimPlateIdsRef.current.add(plateId);
      scheduleAutomaticTrim();
    },
    [scheduleAutomaticTrim],
  );
  const clearAutomaticTrimTimer = useCallback(() => {
    if (automaticTrimTimerRef.current === null) return;
    globalThis.clearTimeout(automaticTrimTimerRef.current);
    automaticTrimTimerRef.current = null;
  }, []);
  const flushAutomaticTrim = useCallback(async () => {
    if (heldPrintedPixelPlateIdsRef.current.size > 0) {
      await new Promise<void>((resolve) => {
        heldInteractionWaitersRef.current.add(resolve);
      });
    }
    clearAutomaticTrimTimer();
    const flushNext = async (): Promise<typeof workspaceRef.current | null> => {
      const succeeded = await runAutomaticTrim();
      if (!succeeded) return null;
      clearAutomaticTrimTimer();
      if (
        automaticTrimRunRef.current !== null ||
        automaticTrimPlateIdsRef.current.size > 0
      ) {
        return flushNext();
      }
      return workspaceRef.current;
    };
    return flushNext();
  }, [clearAutomaticTrimTimer, runAutomaticTrim]);
  const cancelAutomaticTrim = useCallback(() => {
    automaticTrimGenerationRef.current += 1;
    clearAutomaticTrimTimer();
    automaticTrimPlateIdsRef.current.clear();
    heldPrintedPixelPlateIdsRef.current.clear();
    heldInteractionWaitersRef.current.forEach((resolve) => resolve());
    heldInteractionWaitersRef.current.clear();
  }, [clearAutomaticTrimTimer]);
  useEffect(
    () => () => {
      automaticTrimGenerationRef.current += 1;
      clearAutomaticTrimTimer();
      automaticTrimPlateIdsRef.current.clear();
      heldPrintedPixelPlateIdsRef.current.clear();
      heldInteractionWaitersRef.current.forEach((resolve) => resolve());
      heldInteractionWaitersRef.current.clear();
    },
    [clearAutomaticTrimTimer],
  );
  const editWorkspace = useCallback((workspace: typeof state.workspace) => {
    workspaceRef.current = workspace;
    dispatch({ type: "edit-workspace", workspace });
  }, []);
  const editPrintedPixels = useCallback(
    (workspace: typeof state.workspace, plateId: string) => {
      editWorkspace(workspace);
      requestAutomaticTrim(plateId);
    },
    [editWorkspace, requestAutomaticTrim],
  );
  const beginPrintedPixelInteraction = useCallback(
    (plateId: string) => {
      if (heldPrintedPixelPlateIdsRef.current.size === 0) {
        automaticTrimGenerationRef.current += 1;
        clearAutomaticTrimTimer();
        const activeTrimPlateId = automaticTrimActivePlateIdRef.current;
        if (activeTrimPlateId) {
          automaticTrimPlateIdsRef.current.add(activeTrimPlateId);
        }
      }
      heldPrintedPixelPlateIdsRef.current.add(plateId);
    },
    [clearAutomaticTrimTimer],
  );
  const editPrintedPixelsDuringInteraction = useCallback(
    (workspace: typeof state.workspace, plateId: string) => {
      automaticTrimPlateIdsRef.current.add(plateId);
      editWorkspace(workspace);
    },
    [editWorkspace],
  );
  const finishPrintedPixelInteraction = useCallback(
    (plateId: string) => {
      heldPrintedPixelPlateIdsRef.current.delete(plateId);
      if (heldPrintedPixelPlateIdsRef.current.size > 0) return;
      heldInteractionWaitersRef.current.forEach((resolve) => resolve());
      heldInteractionWaitersRef.current.clear();
      scheduleAutomaticTrim();
    },
    [scheduleAutomaticTrim],
  );
  const updatePlate = useCallback(
    (plateId: string, update: (plate: LabelPlate) => LabelPlate) => {
      editPrintedPixels(
        replacePlate(state.workspace, plateId, update),
        plateId,
      );
    },
    [editPrintedPixels, state.workspace],
  );
  const updateElement = useCallback(
    (elementId: string, update: (element: LabelElement) => LabelElement) => {
      if (!activePlate) return;
      editPrintedPixels(
        replaceElement(state.workspace, activePlate.id, elementId, update),
        activePlate.id,
      );
    },
    [activePlate, editPrintedPixels, state.workspace],
  );

  const save = useCallback(
    async (saveAs = false) => {
      try {
        const workspace = await flushAutomaticTrim();
        if (!workspace) return;
        const result = saveAs
          ? await host.saveWorkspaceAs(workspace)
          : await host.saveWorkspace(workspace);
        if (result.status === "saved") {
          dispatch({
            type: "mark-saved",
            savedAt: result.savedAt,
            fileName: result.fileName,
            workspace,
          });
          dispatch(toastAction("success", `Saved ${result.fileName}`));
        } else if (result.status === "failed") {
          dispatch(toastAction("error", result.error.message));
        } else {
          dispatch(toastAction("neutral", "Save canceled"));
        }
      } catch {
        dispatch(
          toastAction("error", "The workspace could not be saved. Try again."),
        );
      }
    },
    [flushAutomaticTrim, host],
  );

  const newWorkspace = useCallback(async () => {
    try {
      const workspace = await flushAutomaticTrim();
      if (!workspace) return;
      const result = await host.newWorkspace(state.dirty, workspace);
      if (result.status === "created") {
        cancelAutomaticTrim();
        dispatch({
          type: "load-workspace",
          workspace: result.document,
          fileName: null,
        });
        dispatch(toastAction("success", "New workspace created"));
      } else if (result.status === "failed") {
        dispatch(toastAction("error", result.error.message));
      } else {
        dispatch(toastAction("neutral", "New workspace canceled"));
      }
    } catch {
      dispatch(
        toastAction(
          "error",
          "A new workspace could not be created. Try again.",
        ),
      );
    }
  }, [cancelAutomaticTrim, flushAutomaticTrim, host, state.dirty]);

  const openWorkspace = useCallback(async () => {
    try {
      const workspace = await flushAutomaticTrim();
      if (!workspace) return;
      const result = await host.openWorkspace(state.dirty, workspace);
      if (result.status === "opened") {
        cancelAutomaticTrim();
        dispatch({
          type: "load-workspace",
          workspace: result.document,
          fileName: result.fileName,
        });
        dispatch(toastAction("success", `Opened ${result.fileName}`));
      } else if (result.status === "failed") {
        dispatch(toastAction("error", result.error.message));
      } else {
        dispatch(toastAction("neutral", "Open canceled"));
      }
    } catch {
      dispatch(
        toastAction("error", "The workspace could not be opened. Try again."),
      );
    }
  }, [cancelAutomaticTrim, flushAutomaticTrim, host, state.dirty]);

  const startDiscovery = useCallback(async () => {
    dispatch({ type: "discovery-started" });
    try {
      const printers = await host.discoverPrinters();
      dispatch({ type: "discovery-finished", printers });
    } catch {
      dispatch({ type: "discovery-failed" });
      dispatch(toastAction("error", "Printer search failed. Try again."));
    }
  }, [host]);

  const addPrinter = useCallback(
    async (printerId: string): Promise<boolean> => {
      printerMutationGeneration.current += 1;
      try {
        const printers = await host.addPrinter(printerId);
        dispatch({ type: "set-printers", printers, preferredId: printerId });
        selectPrinter(printerId);
        dispatch(toastAction("success", "Printer added"));
        return true;
      } catch (error) {
        dispatch(
          toastAction(
            "error",
            remotePrinterFailureMessage(
              error,
              "The printer could not be added. Try again.",
            ),
          ),
        );
        return false;
      }
    },
    [host, selectPrinter],
  );

  const removePrinter = useCallback(
    async (printerId: string) => {
      if (!host.removePrinter) {
        dispatch(toastAction("neutral", "Printer removal is not available."));
        return;
      }
      printerMutationGeneration.current += 1;
      try {
        const printers = await host.removePrinter(printerId);
        if (printers.some((printer) => printer.id === printerId)) {
          throw new Error("The printer is still configured.");
        }
        const preferredId =
          state.activePrinterId === printerId
            ? printers[0]?.id
            : state.activePrinterId;
        dispatch({
          type: "set-printers",
          printers,
          ...(preferredId ? { preferredId } : {}),
        });
        if (preferredId && preferredId !== state.activePrinterId) {
          selectPrinter(preferredId);
        }
        dispatch(toastAction("success", "Printer removed"));
      } catch {
        dispatch(toastAction("error", "The printer could not be removed."));
      }
    },
    [host, selectPrinter, state.activePrinterId],
  );

  const print = useCallback(
    async (all: boolean) => {
      if (printInProgress.current) return;
      if (!activePlate || !activePrinter) {
        dispatch({ type: "set-print-menu", open: false });
        dispatch(toastAction("error", "Select a printer before printing."));
        return;
      }
      printInProgress.current = true;
      printCancellationRequested.current = false;
      setIsPrinting(true);
      dispatch({ type: "set-print-menu", open: false });
      dispatch(
        toastAction(
          "neutral",
          activePrinter.state === "ready"
            ? "Sending label to printer…"
            : "Connecting to printer…",
          true,
        ),
      );
      try {
        const workspace = await flushAutomaticTrim();
        if (!workspace) return;
        const result = await host.print({
          document: workspace,
          printerId: activePrinter.id,
          plateIds: all
            ? workspace.plates.map((plate) => plate.id)
            : [activePlate.id],
        });
        dispatch(toastAction("success", result.message));
      } catch (error) {
        if (printCancellationRequested.current) {
          dispatch(toastAction("neutral", "Print canceled"));
        } else {
          dispatch(
            toastAction(
              "error",
              `${activePrinter.name}: ${printFailureMessage(error)}`,
            ),
          );
        }
      } finally {
        printInProgress.current = false;
        printCancellationRequested.current = false;
        setIsPrinting(false);
      }
    },
    [activePlate, activePrinter, flushAutomaticTrim, host],
  );

  const cancelPrint = useCallback(async () => {
    if (!printInProgress.current || !host.cancelPrint) return;
    printCancellationRequested.current = true;
    try {
      await host.cancelPrint();
    } catch {
      printCancellationRequested.current = false;
      dispatch(toastAction("error", "The print job could not be canceled."));
    }
  }, [host]);

  const addPlate = useCallback(() => {
    const settingsSource = activePlate;
    const heightMm =
      settingsSource?.size.heightMm ??
      state.workspace.defaultPlateSize.heightMm;
    const plate = createPlate(
      state.workspace,
      nonPrintableMarginsMm(
        heightMm,
        activePrinter?.printableWidthMm,
        activePrinter?.marginTopMm,
        activePrinter?.marginBottomMm,
        activePrinter?.rasterAlignment,
      ),
      settingsSource,
    );
    editPrintedPixels(
      {
        ...state.workspace,
        plates: [...state.workspace.plates, plate],
      },
      plate.id,
    );
    dispatch({
      type: "select-plate",
      plateId: plate.id,
      elementId: plate.elements[0]?.id ?? null,
    });
  }, [activePlate, activePrinter, editPrintedPixels, state.workspace]);
  const deletePlate = useCallback(
    (plateId: string) => {
      if (state.workspace.plates.length === 1) return;
      const deletedIndex = state.workspace.plates.findIndex(
        (plate) => plate.id === plateId,
      );
      if (deletedIndex < 0) return;
      const plates = state.workspace.plates.filter(
        (plate) => plate.id !== plateId,
      );
      editWorkspace({ ...state.workspace, plates });
      if (plateId === state.activePlateId) {
        const nextPlate = plates[Math.min(deletedIndex, plates.length - 1)];
        if (nextPlate) {
          dispatch({
            type: "select-plate",
            plateId: nextPlate.id,
            elementId: null,
          });
        }
      }
    },
    [editWorkspace, state.activePlateId, state.workspace],
  );
  const addText = useCallback(() => {
    if (!activePlate) return;
    const sourcePlate = isFlagPlate(activePlate)
      ? toggleFlagPlate(activePlate)
      : activePlate;
    const element = createText(sourcePlate, insertionMargins(sourcePlate));
    updatePlate(activePlate.id, (plate) =>
      appendElementAndFlagPeer(plate, element),
    );
    dispatch({ type: "select-element", elementId: element.id });
  }, [activePlate, insertionMargins, updatePlate]);
  const addSpecial = useCallback(
    (kind: "flag") => {
      if (!activePlate || kind !== "flag") return;
      editPrintedPixels(
        replacePlate(state.workspace, activePlate.id, toggleFlagPlate),
        activePlate.id,
      );
    },
    [activePlate, editPrintedPixels, state.workspace],
  );

  const addShape = useCallback(
    (shapeType: NonNullable<ShapeElement["shapeType"]>) => {
      if (!activePlate) return;
      const sourcePlate = isFlagPlate(activePlate)
        ? toggleFlagPlate(activePlate)
        : activePlate;
      const element = createShape(sourcePlate, shapeType);
      updatePlate(activePlate.id, (plate) =>
        appendElementAndFlagPeer(plate, element),
      );
      dispatch({ type: "select-element", elementId: element.id });
    },
    [activePlate, updatePlate],
  );

  const appendImage = useCallback(
    (
      plateId: string,
      source: string,
      dimensions?: { readonly width: number; readonly height: number },
      editorSource?: DrawingEditorSource,
    ) => {
      const workspace = workspaceRef.current;
      const currentPlate = workspace.plates.find(
        (plate) => plate.id === plateId,
      );
      if (!currentPlate) return;
      const sourcePlate = isFlagPlate(currentPlate)
        ? toggleFlagPlate(currentPlate)
        : currentPlate;
      const baseElement = {
        ...createImage(sourcePlate, source, insertionMargins(sourcePlate)),
        ...(editorSource ? { editorSource } : {}),
      };
      const element = dimensions
        ? fitNewImageFrame(
            baseElement,
            sourcePlate,
            dimensions.width,
            dimensions.height,
            insertionMargins(sourcePlate),
          )
        : baseElement;
      editPrintedPixels(
        replacePlate(workspace, plateId, (plate) =>
          appendElementAndFlagPeer(plate, element),
        ),
        plateId,
      );
      dispatch({ type: "select-element", elementId: element.id });
      return element.id;
    },
    [editPrintedPixels, insertionMargins],
  );

  const addDrawing = useCallback(
    (result: DrawingImageResult) => {
      if (!activePlate) return;
      return appendImage(
        activePlate.id,
        result.source,
        {
          width: result.widthPixels,
          height: result.heightPixels,
        },
        result.editorSource,
      );
    },
    [activePlate, appendImage],
  );

  const addImage = useCallback(
    (file: File) => {
      if (!activePlate) return;
      if (!PRINTABLE_IMAGE_TYPES.has(file.type.toLowerCase())) {
        dispatch(
          toastAction("error", "Choose a PNG, JPEG, GIF, WebP, or BMP image."),
        );
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        dispatch(toastAction("error", "Image must be smaller than 10 MB"));
        return;
      }
      const plateId = activePlate.id;
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => {
          if (typeof reader.result !== "string") return;
          const source = reader.result;
          if (globalThis.navigator?.userAgent.includes("jsdom")) {
            appendImage(plateId, source);
            return;
          }
          void drawingResultFromImageSource(source)
            .then((result) => {
              if (!result) {
                dispatch(
                  toastAction("error", "The image has no visible pixels."),
                );
                return;
              }
              const elementId = appendImage(
                plateId,
                result.source,
                {
                  width: result.widthPixels,
                  height: result.heightPixels,
                },
                result.editorSource,
              );
              if (elementId) {
                rememberDrawingEditorSource(
                  elementId,
                  result.source,
                  result.editorSource,
                );
              }
            })
            .catch(() =>
              dispatch(toastAction("error", "The image could not open.")),
            );
        },
        { once: true },
      );
      reader.addEventListener(
        "error",
        () => dispatch(toastAction("error", "Image could not be read")),
        { once: true },
      );
      reader.readAsDataURL(file);
    },
    [activePlate, appendImage],
  );

  const deleteSelected = useCallback(() => {
    if (!activePlate || !selectedElement) return;
    updatePlate(activePlate.id, (plate) =>
      deleteElementAndFlagPeer(plate, selectedElement.id),
    );
    dispatch({ type: "select-element", elementId: null });
  }, [activePlate, selectedElement, updatePlate]);

  const undo = useCallback(() => {
    cancelAutomaticTrim();
    dispatch({ type: "undo" });
  }, [cancelAutomaticTrim]);
  const redo = useCallback(() => {
    cancelAutomaticTrim();
    dispatch({ type: "redo" });
  }, [cancelAutomaticTrim]);

  const shortcutRef = useRef({
    save,
    deleteSelected,
    undo,
    redo,
    zoom: state.zoom,
  });
  shortcutRef.current = { save, deleteSelected, undo, redo, zoom: state.zoom };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      const dialogIsOpen =
        target instanceof HTMLElement &&
        Boolean(target.closest('[role="dialog"]'));
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcutRef.current.save(event.shiftKey);
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) shortcutRef.current.redo();
        else shortcutRef.current.undo();
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        shortcutRef.current.redo();
      } else if (command && ["+", "="].includes(event.key)) {
        event.preventDefault();
        dispatch({
          type: "set-zoom",
          zoom: clamp(shortcutRef.current.zoom + 10, MIN_ZOOM, MAX_ZOOM),
        });
      } else if (command && event.key === "-") {
        event.preventDefault();
        dispatch({
          type: "set-zoom",
          zoom: clamp(shortcutRef.current.zoom - 10, MIN_ZOOM, MAX_ZOOM),
        });
      } else if (command && event.key === "0") {
        event.preventDefault();
        dispatch({ type: "set-zoom", zoom: 100 });
      } else if (
        !isEditing &&
        !dialogIsOpen &&
        (event.key === "Delete" || event.key === "Backspace")
      ) {
        event.preventDefault();
        shortcutRef.current.deleteSelected();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    state,
    activePlate,
    selectedText,
    selectedImage,
    selectedShape,
    activePrinter,
    canPrint,
    canCancelPrint,
    dispatch,
    save,
    newWorkspace,
    openWorkspace,
    startDiscovery,
    addPrinter,
    removePrinter,
    selectPrinter,
    updatePrinterSettings,
    print,
    cancelPrint,
    addPlate,
    deletePlate,
    addText,
    addImage,
    addDrawing,
    addShape,
    addSpecial,
    deleteSelected,
    updatePlate,
    updateElement,
    editWorkspace,
    editPrintedPixels,
    beginPrintedPixelInteraction,
    editPrintedPixelsDuringInteraction,
    finishPrintedPixelInteraction,
    undo,
    redo,
  };
}

const PRINTABLE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);

function printFailureMessage(error: unknown): string {
  return printerFailureMessage(
    error,
    "The label could not be printed. Check the printer and try again.",
  );
}
