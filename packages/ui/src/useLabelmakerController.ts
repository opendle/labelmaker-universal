import type {
  ImageElement,
  LabelElement,
  LabelPlate,
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
} from "./app-state.js";
import {
  clamp,
  createImage,
  createPlate,
  createText,
  toggleFlagPlate,
} from "./editor-operations.js";
import type { LabelmakerHost, PrinterSettings } from "./host.js";
import {
  printerFailureMessage,
  remotePrinterFailureMessage,
} from "./printer-failure-message.js";

export function useLabelmakerController(host: LabelmakerHost) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const [isPrinting, setIsPrinting] = useState(false);
  const printInProgress = useRef(false);
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
  const activePrinter = state.printers.find(
    (printer) => printer.id === state.activePrinterId,
  );
  // The main process performs a fresh status check and reconnect before the
  // job. Keep print enabled for a configured printer so a stale renderer
  // status does not block a recoverable connection.
  const canPrint = activePrinter !== undefined && !isPrinting;

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
      void host
        .listPrinters()
        .then((printers) => {
          if (active)
            dispatch({
              type: "set-printers",
              printers,
              ...(preferredId ? { preferredId } : {}),
            });
        })
        .catch(() => {
          if (active && showError)
            dispatch({
              type: "set-toast",
              toast: {
                tone: "error",
                message: "Printers could not be loaded. Try again.",
              },
            });
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
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "The printer selection could not be saved.",
          },
        });
      });
    },
    [host],
  );

  const updatePrinterSettings = useCallback(
    async (printerId: string, settings: PrinterSettings) => {
      if (!host.updatePrinterSettings) return false;
      try {
        const printers = await host.updatePrinterSettings(printerId, settings);
        dispatch({
          type: "set-printers",
          printers,
          ...(state.activePrinterId
            ? { preferredId: state.activePrinterId }
            : {}),
        });
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: "Printer settings saved" },
        });
        return true;
      } catch {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "Printer settings could not be saved. Try again.",
          },
        });
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

  const editWorkspace = useCallback(
    (workspace: typeof state.workspace) =>
      dispatch({ type: "edit-workspace", workspace }),
    [],
  );
  const updatePlate = useCallback(
    (plateId: string, update: (plate: LabelPlate) => LabelPlate) => {
      editWorkspace(replacePlate(state.workspace, plateId, update));
    },
    [editWorkspace, state.workspace],
  );
  const updateElement = useCallback(
    (elementId: string, update: (element: LabelElement) => LabelElement) => {
      if (!activePlate) return;
      editWorkspace(
        replaceElement(state.workspace, activePlate.id, elementId, update),
      );
    },
    [activePlate, editWorkspace, state.workspace],
  );

  const save = useCallback(
    async (saveAs = false) => {
      try {
        const result = saveAs
          ? await host.saveWorkspaceAs(state.workspace)
          : await host.saveWorkspace(state.workspace);
        if (result.status === "saved") {
          dispatch({
            type: "mark-saved",
            savedAt: result.savedAt,
            fileName: result.fileName,
          });
          dispatch({
            type: "set-toast",
            toast: { tone: "success", message: `Saved ${result.fileName}` },
          });
        } else if (result.status === "failed") {
          dispatch({
            type: "set-toast",
            toast: { tone: "error", message: result.error.message },
          });
        } else {
          dispatch({
            type: "set-toast",
            toast: { tone: "neutral", message: "Save canceled" },
          });
        }
      } catch {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "The workspace could not be saved. Try again.",
          },
        });
      }
    },
    [host, state.workspace],
  );

  const newWorkspace = useCallback(async () => {
    try {
      const result = await host.newWorkspace(state.dirty, state.workspace);
      if (result.status === "created") {
        dispatch({
          type: "load-workspace",
          workspace: result.document,
          fileName: null,
        });
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: "New workspace created" },
        });
      } else if (result.status === "failed") {
        dispatch({
          type: "set-toast",
          toast: { tone: "error", message: result.error.message },
        });
      } else {
        dispatch({
          type: "set-toast",
          toast: { tone: "neutral", message: "New workspace canceled" },
        });
      }
    } catch {
      dispatch({
        type: "set-toast",
        toast: {
          tone: "error",
          message: "A new workspace could not be created. Try again.",
        },
      });
    }
  }, [host, state.dirty, state.workspace]);

  const openWorkspace = useCallback(async () => {
    try {
      const result = await host.openWorkspace(state.dirty, state.workspace);
      if (result.status === "opened") {
        dispatch({
          type: "load-workspace",
          workspace: result.document,
          fileName: result.fileName,
        });
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: `Opened ${result.fileName}` },
        });
      } else if (result.status === "failed") {
        dispatch({
          type: "set-toast",
          toast: { tone: "error", message: result.error.message },
        });
      } else {
        dispatch({
          type: "set-toast",
          toast: { tone: "neutral", message: "Open canceled" },
        });
      }
    } catch {
      dispatch({
        type: "set-toast",
        toast: {
          tone: "error",
          message: "The workspace could not be opened. Try again.",
        },
      });
    }
  }, [host, state.dirty, state.workspace]);

  const startDiscovery = useCallback(async () => {
    dispatch({ type: "discovery-started" });
    try {
      const printers = await host.discoverPrinters();
      dispatch({ type: "discovery-finished", printers });
    } catch {
      dispatch({ type: "discovery-failed" });
      dispatch({
        type: "set-toast",
        toast: { tone: "error", message: "Printer search failed. Try again." },
      });
    }
  }, [host]);

  const addPrinter = useCallback(
    async (printerId: string): Promise<boolean> => {
      try {
        const printers = await host.addPrinter(printerId);
        dispatch({ type: "set-printers", printers, preferredId: printerId });
        selectPrinter(printerId);
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: "Printer added" },
        });
        return true;
      } catch (error) {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: remotePrinterFailureMessage(
              error,
              "The printer could not be added. Try again.",
            ),
          },
        });
        return false;
      }
    },
    [host, selectPrinter],
  );

  const removePrinter = useCallback(
    async (printerId: string) => {
      if (!host.removePrinter) {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "neutral",
            message: "Printer removal is not available.",
          },
        });
        return;
      }
      try {
        const printers = await host.removePrinter(printerId);
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
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: "Printer removed" },
        });
      } catch {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "The printer could not be removed.",
          },
        });
      }
    },
    [host, selectPrinter, state.activePrinterId],
  );

  const print = useCallback(
    async (all: boolean) => {
      if (printInProgress.current) return;
      if (!activePlate || !activePrinter) {
        dispatch({ type: "set-print-menu", open: false });
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "Select a printer before printing.",
          },
        });
        return;
      }
      printInProgress.current = true;
      setIsPrinting(true);
      dispatch({ type: "set-print-menu", open: false });
      dispatch({
        type: "set-toast",
        toast: {
          tone: "neutral",
          message:
            activePrinter.state === "ready"
              ? "Sending label to printer…"
              : "Connecting to printer…",
          busy: true,
        },
      });
      try {
        const result = await host.print({
          document: state.workspace,
          printerId: activePrinter.id,
          plateIds: all
            ? state.workspace.plates.map((plate) => plate.id)
            : [activePlate.id],
        });
        dispatch({
          type: "set-toast",
          toast: { tone: "success", message: result.message },
        });
      } catch (error) {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: printFailureMessage(error),
          },
        });
      } finally {
        printInProgress.current = false;
        setIsPrinting(false);
      }
    },
    [activePlate, activePrinter, host, state.workspace],
  );

  const addPlate = useCallback(() => {
    const plate = createPlate(state.workspace);
    editWorkspace({
      ...state.workspace,
      plates: [...state.workspace.plates, plate],
    });
    dispatch({
      type: "select-plate",
      plateId: plate.id,
      elementId: plate.elements[0]?.id ?? null,
    });
  }, [editWorkspace, state.workspace]);
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
    const element = createText(activePlate);
    updatePlate(activePlate.id, (plate) => ({
      ...plate,
      elements: [...plate.elements, element],
    }));
    dispatch({ type: "select-element", elementId: element.id });
  }, [activePlate, updatePlate]);
  const addSpecial = useCallback(
    (kind: "flag") => {
      if (!activePlate || kind !== "flag") return;
      editWorkspace(
        replacePlate(state.workspace, activePlate.id, toggleFlagPlate),
      );
    },
    [activePlate, editWorkspace, state.workspace],
  );

  const addImage = useCallback(
    (file: File) => {
      if (!activePlate) return;
      if (!PRINTABLE_IMAGE_TYPES.has(file.type.toLowerCase())) {
        dispatch({
          type: "set-toast",
          toast: {
            tone: "error",
            message: "Choose a PNG, JPEG, GIF, WebP, or BMP image.",
          },
        });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        dispatch({
          type: "set-toast",
          toast: { tone: "error", message: "Image must be smaller than 10 MB" },
        });
        return;
      }
      const plateId = activePlate.id;
      const reader = new FileReader();
      reader.addEventListener(
        "load",
        () => {
          if (typeof reader.result !== "string") return;
          const currentPlate = state.workspace.plates.find(
            (plate) => plate.id === plateId,
          );
          if (!currentPlate) return;
          const element = createImage(currentPlate, reader.result);
          editWorkspace(
            replacePlate(state.workspace, plateId, (plate) => ({
              ...plate,
              elements: [...plate.elements, element],
            })),
          );
          dispatch({ type: "select-element", elementId: element.id });
        },
        { once: true },
      );
      reader.addEventListener(
        "error",
        () =>
          dispatch({
            type: "set-toast",
            toast: { tone: "error", message: "Image could not be read" },
          }),
        { once: true },
      );
      reader.readAsDataURL(file);
    },
    [activePlate, editWorkspace, state.workspace],
  );

  const deleteSelected = useCallback(() => {
    if (!activePlate || !selectedElement) return;
    updatePlate(activePlate.id, (plate) => ({
      ...plate,
      elements: plate.elements.filter(
        (element) => element.id !== selectedElement.id,
      ),
    }));
    dispatch({ type: "select-element", elementId: null });
  }, [activePlate, selectedElement, updatePlate]);

  const shortcutRef = useRef({ save, deleteSelected, zoom: state.zoom });
  shortcutRef.current = { save, deleteSelected, zoom: state.zoom };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const target = event.target;
      const isEditing =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (command && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void shortcutRef.current.save(event.shiftKey);
      } else if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (command && ["+", "="].includes(event.key)) {
        event.preventDefault();
        dispatch({
          type: "set-zoom",
          zoom: clamp(shortcutRef.current.zoom + 10, 60, 140),
        });
      } else if (command && event.key === "-") {
        event.preventDefault();
        dispatch({
          type: "set-zoom",
          zoom: clamp(shortcutRef.current.zoom - 10, 60, 140),
        });
      } else if (command && event.key === "0") {
        event.preventDefault();
        dispatch({ type: "set-zoom", zoom: 100 });
      } else if (
        !isEditing &&
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
    activePrinter,
    canPrint,
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
    addPlate,
    deletePlate,
    addText,
    addImage,
    addSpecial,
    updatePlate,
    updateElement,
    editWorkspace,
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

export type LabelmakerController = ReturnType<typeof useLabelmakerController>;
export type { ImageElement, TextElement };
