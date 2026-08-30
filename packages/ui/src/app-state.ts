import type {
  LabelDocument,
  LabelElement,
  LabelPlate,
} from "@labelmaker/domain";

import type { PrinterSummary } from "./host.js";
import { sampleDocument } from "./sample.js";

export type Toast = {
  readonly tone: "success" | "neutral" | "error";
  readonly message: string;
  readonly busy?: boolean;
};

export interface AppState {
  readonly workspace: LabelDocument;
  readonly past: readonly LabelDocument[];
  readonly future: readonly LabelDocument[];
  readonly activePlateId: string;
  readonly selectedElementId: string | null;
  readonly printers: readonly PrinterSummary[];
  readonly activePrinterId: string;
  readonly dirty: boolean;
  readonly savedAt: string | null;
  readonly workspaceFileName: string | null;
  readonly addPrinterOpen: boolean;
  readonly discovering: boolean;
  readonly discoveryFailed: boolean;
  readonly discovered: readonly PrinterSummary[];
  readonly printerSettingsId: string | null;
  readonly printMenuOpen: boolean;
  readonly toast: Toast | null;
  readonly zoom: number;
  readonly recoveryReady: boolean;
}

export type AppAction =
  | { readonly type: "edit-workspace"; readonly workspace: LabelDocument }
  | { readonly type: "apply-automatic-trim"; readonly workspace: LabelDocument }
  | {
      readonly type: "load-workspace";
      readonly workspace: LabelDocument;
      readonly fileName: string | null;
    }
  | {
      readonly type: "mark-saved";
      readonly savedAt: string;
      readonly fileName: string;
      readonly workspace: LabelDocument;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | {
      readonly type: "select-plate";
      readonly plateId: string;
      readonly elementId: string | null;
    }
  | { readonly type: "select-element"; readonly elementId: string | null }
  | {
      readonly type: "set-printers";
      readonly printers: readonly PrinterSummary[];
      readonly preferredId?: string;
    }
  | { readonly type: "set-active-printer"; readonly printerId: string }
  | { readonly type: "open-add-printer" }
  | { readonly type: "close-add-printer" }
  | { readonly type: "discovery-started" }
  | {
      readonly type: "discovery-finished";
      readonly printers: readonly PrinterSummary[];
    }
  | { readonly type: "discovery-failed" }
  | { readonly type: "open-printer-settings"; readonly printerId: string }
  | { readonly type: "close-printer-settings" }
  | { readonly type: "set-print-menu"; readonly open: boolean }
  | { readonly type: "set-toast"; readonly toast: Toast | null }
  | { readonly type: "set-zoom"; readonly zoom: number }
  | {
      readonly type: "restore-session";
      readonly workspace: LabelDocument;
      readonly activePlateId: string;
      readonly selectedElementId: string | null;
      readonly dirty: boolean;
      readonly savedAt: string | null;
      readonly fileName: string | null;
      readonly zoom: number;
    }
  | { readonly type: "recovery-ready" };

export const initialAppState: AppState = {
  workspace: sampleDocument,
  past: [],
  future: [],
  activePlateId: sampleDocument.plates[0]?.id ?? "",
  selectedElementId: sampleDocument.plates[0]?.elements[0]?.id ?? null,
  printers: [],
  activePrinterId: "",
  dirty: false,
  savedAt: null,
  workspaceFileName: null,
  addPrinterOpen: false,
  discovering: false,
  discoveryFailed: false,
  discovered: [],
  printerSettingsId: null,
  printMenuOpen: false,
  toast: null,
  zoom: 100,
  recoveryReady: false,
};

const HISTORY_LIMIT = 100;

function selectionForWorkspace(state: AppState, workspace: LabelDocument) {
  const activePlate =
    workspace.plates.find((plate) => plate.id === state.activePlateId) ??
    workspace.plates[0];
  const selectedElement = activePlate?.elements.find(
    (element) => element.id === state.selectedElementId,
  );
  return {
    activePlateId: activePlate?.id ?? "",
    selectedElementId: selectedElement?.id ?? null,
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "edit-workspace":
      return {
        ...state,
        workspace: action.workspace,
        past: [...state.past.slice(-(HISTORY_LIMIT - 1)), state.workspace],
        future: [],
        dirty: true,
      };
    case "apply-automatic-trim":
      return {
        ...state,
        ...selectionForWorkspace(state, action.workspace),
        workspace: action.workspace,
      };
    case "load-workspace":
      return {
        ...state,
        workspace: action.workspace,
        past: [],
        future: [],
        activePlateId: action.workspace.plates[0]?.id ?? "",
        selectedElementId: action.workspace.plates[0]?.elements[0]?.id ?? null,
        dirty: false,
        savedAt: null,
        workspaceFileName: action.fileName,
      };
    case "mark-saved":
      return {
        ...state,
        dirty: state.workspace !== action.workspace,
        savedAt: action.savedAt,
        workspaceFileName: action.fileName,
      };
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        ...selectionForWorkspace(state, previous),
        workspace: previous,
        past: state.past.slice(0, -1),
        future: [state.workspace, ...state.future],
        dirty: true,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        ...selectionForWorkspace(state, next),
        workspace: next,
        past: [...state.past, state.workspace],
        future: state.future.slice(1),
        dirty: true,
      };
    }
    case "select-plate":
      return {
        ...state,
        activePlateId: action.plateId,
        selectedElementId: action.elementId,
      };
    case "select-element":
      return { ...state, selectedElementId: action.elementId };
    case "set-printers": {
      const preferred = action.preferredId
        ? action.printers.find((printer) => printer.id === action.preferredId)
        : undefined;
      const current = action.printers.find(
        (printer) => printer.id === state.activePrinterId,
      );
      return {
        ...state,
        printers: action.printers,
        activePrinterId:
          preferred?.id ?? current?.id ?? action.printers[0]?.id ?? "",
      };
    }
    case "set-active-printer":
      return { ...state, activePrinterId: action.printerId };
    case "open-add-printer":
      return { ...state, addPrinterOpen: true };
    case "close-add-printer":
      return {
        ...state,
        addPrinterOpen: false,
        discovering: false,
        discoveryFailed: false,
      };
    case "discovery-started":
      return {
        ...state,
        addPrinterOpen: true,
        discovering: true,
        discoveryFailed: false,
        discovered: [],
      };
    case "discovery-finished":
      return {
        ...state,
        discovering: false,
        discoveryFailed: false,
        discovered: action.printers,
      };
    case "discovery-failed":
      return {
        ...state,
        discovering: false,
        discoveryFailed: true,
        discovered: [],
      };
    case "open-printer-settings":
      return {
        ...state,
        printerSettingsId: action.printerId,
        printMenuOpen: false,
      };
    case "close-printer-settings":
      return { ...state, printerSettingsId: null };
    case "set-print-menu":
      return { ...state, printMenuOpen: action.open };
    case "set-toast":
      return { ...state, toast: action.toast };
    case "set-zoom":
      return { ...state, zoom: action.zoom };
    case "restore-session":
      return {
        ...state,
        workspace: action.workspace,
        past: [],
        future: [],
        activePlateId: action.activePlateId,
        selectedElementId: action.selectedElementId,
        dirty: action.dirty,
        savedAt: action.savedAt,
        workspaceFileName: action.fileName,
        zoom: action.zoom,
        recoveryReady: true,
      };
    case "recovery-ready":
      return { ...state, recoveryReady: true };
  }
}

export function replacePlate(
  workspace: LabelDocument,
  plateId: string,
  update: (plate: LabelPlate) => LabelPlate,
): LabelDocument {
  return {
    ...workspace,
    plates: workspace.plates.map((plate) =>
      plate.id === plateId ? update(plate) : plate,
    ),
  };
}

export function movePlate(
  workspace: LabelDocument,
  plateId: string,
  targetIndex: number,
): LabelDocument {
  const sourceIndex = workspace.plates.findIndex(
    (plate) => plate.id === plateId,
  );
  const boundedTargetIndex = Math.max(
    0,
    Math.min(Math.trunc(targetIndex), workspace.plates.length - 1),
  );
  if (sourceIndex < 0 || sourceIndex === boundedTargetIndex) return workspace;
  const plates = [...workspace.plates];
  const [plate] = plates.splice(sourceIndex, 1);
  if (!plate) return workspace;
  plates.splice(boundedTargetIndex, 0, plate);
  return { ...workspace, plates };
}

export function replaceElement(
  workspace: LabelDocument,
  plateId: string,
  elementId: string,
  update: (element: LabelElement) => LabelElement,
): LabelDocument {
  return replacePlate(workspace, plateId, (plate) => ({
    ...plate,
    elements: plate.elements.map((element) =>
      element.id === elementId ? update(element) : element,
    ),
  }));
}
