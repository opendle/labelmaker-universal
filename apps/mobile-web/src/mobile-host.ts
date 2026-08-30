import {
  createBlankLabelDocument,
  validateLabelDocument,
} from "@labelmaker/documents";
import type {
  HostPlatform,
  LabelmakerHost,
  WorkspaceRecoveryState,
  WorkspaceSaveResult,
} from "@labelmaker/ui";

import { decodeWorkspace, encodeWorkspace } from "./document-codec.js";
import {
  isRecord,
  type NativeBridge,
  NativeBridgeError,
} from "./native-bridge.js";
import { MobilePrinterService } from "./printer-service.js";

export interface MobileHostOptions {
  readonly bridge: NativeBridge;
  readonly platform: Extract<HostPlatform, "ipados" | "android">;
  readonly printerStorageKey: string;
  readonly jobIdPrefix: string;
}

interface WorkspaceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export function createMobileHost({
  bridge,
  platform,
  printerStorageKey,
  jobIdPrefix,
}: MobileHostOptions): LabelmakerHost {
  const printers = new MobilePrinterService(
    bridge,
    printerStorageKey,
    jobIdPrefix,
  );
  bridge.registerConnectionResetHandler(() => {
    void printers.resetNativeConnections();
  });

  const saveWorkspace = async (
    document: Parameters<LabelmakerHost["saveWorkspace"]>[0],
    saveAs: boolean,
  ): Promise<WorkspaceSaveResult> => {
    try {
      const validated = validateLabelDocument(document);
      return await bridge.call("saveWorkspaceFile", {
        fileName: `${safeFileStem(validated.name)}.lbl`,
        gzipBase64: await encodeWorkspace(validated),
        saveAs,
      });
    } catch (error) {
      return failed(
        error,
        "WORKSPACE_WRITE_FAILED",
        "The workspace could not be saved.",
      );
    }
  };

  const resolveReplacement = async (
    hasUnsavedChanges: boolean,
    document: Parameters<LabelmakerHost["saveWorkspace"]>[0],
  ): Promise<
    | "proceed"
    | "canceled"
    | { readonly status: "failed"; readonly error: WorkspaceError }
  > => {
    if (!hasUnsavedChanges) return "proceed";
    const choice = await bridge.call("confirmWorkspaceReplacement", {});
    if (choice === "cancel") return "canceled";
    if (choice === "discard") return "proceed";
    const save = await saveWorkspace(document, false);
    if (save.status === "saved") return "proceed";
    if (save.status === "failed") return save;
    return "canceled";
  };

  return {
    platform,
    presentation: "mobile-touch",
    registerSystemBackHandler: (handler) =>
      bridge.registerSystemBackHandler(handler),

    listPrinters: () => printers.listPrinters(),
    discoverPrinters: () => printers.discoverPrinters(),
    addPrinter: (printerId) => printers.addPrinter(printerId),
    removePrinter: (printerId) => printers.removePrinter(printerId),
    getActivePrinterId: async () => printers.getActivePrinterId(),
    setActivePrinterId: async (printerId) =>
      printers.setActivePrinterId(printerId),
    updatePrinterSettings: (printerId, settings) =>
      printers.updatePrinterSettings(printerId, settings),

    loadWorkspaceRecovery: async () => {
      try {
        return validateRecovery(await bridge.call("loadWorkspaceRecovery", {}));
      } catch {
        return null;
      }
    },

    storeWorkspaceRecovery: async (state) => {
      const document = validateLabelDocument(state.document);
      await bridge.call("storeWorkspaceRecovery", {
        state: { ...state, document },
      });
    },

    newWorkspace: async (hasUnsavedChanges, document) => {
      const replacement = await resolveReplacement(hasUnsavedChanges, document);
      if (replacement === "canceled") return { status: "canceled" };
      if (replacement !== "proceed") return replacement;
      await bridge.call("clearWorkspaceAssociation", {});
      return { status: "created", document: createBlankLabelDocument() };
    },

    openWorkspace: async (hasUnsavedChanges, document) => {
      const replacement = await resolveReplacement(hasUnsavedChanges, document);
      if (replacement === "canceled") return { status: "canceled" };
      if (replacement !== "proceed") return replacement;
      try {
        const selection = await bridge.call("openWorkspaceFile", {});
        if (selection.status === "canceled") return { status: "canceled" };
        const opened = await decodeWorkspace(selection.gzipBase64);
        await bridge.call("acceptOpenedWorkspaceFile", {
          selectionId: selection.selectionId,
        });
        return {
          status: "opened",
          document: opened,
          fileName: selection.fileName,
        };
      } catch (error) {
        return failed(
          error,
          "WORKSPACE_READ_FAILED",
          "The workspace could not be opened.",
        );
      }
    },

    saveWorkspace: (document) => saveWorkspace(document, false),
    saveWorkspaceAs: (document) => saveWorkspace(document, true),
    print: (request) => printers.print(request),
    cancelPrint: () => printers.cancelPrint(),
  };
}

function validateRecovery(value: unknown): WorkspaceRecoveryState | null {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    typeof value.dirty !== "boolean" ||
    typeof value.activePlateId !== "string" ||
    (value.selectedElementId !== null &&
      typeof value.selectedElementId !== "string") ||
    typeof value.zoom !== "number" ||
    value.zoom < 60 ||
    value.zoom > 300 ||
    (value.savedAt !== null && typeof value.savedAt !== "string") ||
    (value.fileName !== null && typeof value.fileName !== "string")
  ) {
    return null;
  }
  const document = validateLabelDocument(value.document);
  if (!document.plates.some((plate) => plate.id === value.activePlateId)) {
    return null;
  }
  return {
    document,
    dirty: value.dirty,
    activePlateId: value.activePlateId,
    selectedElementId: value.selectedElementId,
    zoom: value.zoom,
    savedAt: value.savedAt,
    fileName: value.fileName,
  };
}

function failed(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): { readonly status: "failed"; readonly error: WorkspaceError } {
  if (error instanceof NativeBridgeError) {
    return {
      status: "failed",
      error: { code: error.code, message: error.message, retryable: true },
    };
  }
  return {
    status: "failed",
    error: {
      code: fallbackCode,
      message: error instanceof Error ? error.message : fallbackMessage,
      retryable: false,
    },
  };
}

function safeFileStem(value: string): string {
  const stem = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return stem || "Untitled workspace";
}
