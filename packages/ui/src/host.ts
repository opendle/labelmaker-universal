import type { LabelDocument } from "@labelmaker/domain";
import type { PrinterState, PrinterTransport } from "@labelmaker/printing";

export interface PrinterSummary {
  readonly id: string;
  readonly adapterId: string;
  /** Unchanged name from the printer adapter. Use this to reset a custom name. */
  readonly deviceName?: string;
  readonly name: string;
  readonly model: string;
  readonly transport: PrinterTransport;
  readonly state: PrinterState;
  readonly statusMessage: string;
  readonly dpi?: number;
  readonly rasterWidthPixels?: number;
  readonly printableWidthMm?: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
  readonly darkness?: {
    readonly minimum: number;
    readonly maximum: number;
    readonly step: number;
    readonly defaultValue: number;
    readonly value: number;
  };
  readonly batteryPercent?: number;
}

export interface PrinterSettings {
  /** Omit this value to show the unchanged device name. */
  readonly displayName?: string;
  readonly darkness?: number;
  readonly printHeadSizeMm?: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
}

export interface PrintRequest {
  readonly document: LabelDocument;
  readonly printerId: string;
  readonly plateIds: readonly string[];
}

export type HostPlatform = "macos" | "windows" | "linux";

export interface WorkspaceRecoveryState {
  readonly document: LabelDocument;
  readonly dirty: boolean;
  readonly activePlateId: string;
  readonly selectedElementId: string | null;
  readonly zoom: number;
  readonly savedAt: string | null;
  readonly fileName: string | null;
}

export type WorkspaceRecoveryUpdate = Omit<WorkspaceRecoveryState, "fileName">;

export interface WorkspaceError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type WorkspaceLoadResult =
  | { readonly status: "created"; readonly document: LabelDocument }
  | {
      readonly status: "opened";
      readonly document: LabelDocument;
      readonly fileName: string;
    }
  | { readonly status: "canceled" }
  | { readonly status: "failed"; readonly error: WorkspaceError };

export type WorkspaceSaveResult =
  | {
      readonly status: "saved";
      readonly savedAt: string;
      readonly fileName: string;
    }
  | { readonly status: "canceled" }
  | { readonly status: "failed"; readonly error: WorkspaceError };

export interface LabelmakerHost {
  readonly platform: HostPlatform;
  listPrinters(): Promise<readonly PrinterSummary[]>;
  discoverPrinters(): Promise<readonly PrinterSummary[]>;
  addPrinter(printerId: string): Promise<readonly PrinterSummary[]>;
  /** Remove a configured printer. Older hosts may omit this until supported. */
  removePrinter?(printerId: string): Promise<readonly PrinterSummary[]>;
  getActivePrinterId?(): Promise<string | null>;
  setActivePrinterId?(printerId: string): Promise<void>;
  updatePrinterSettings?(
    printerId: string,
    settings: PrinterSettings,
  ): Promise<readonly PrinterSummary[]>;
  loadWorkspaceRecovery?(): Promise<WorkspaceRecoveryState | null>;
  storeWorkspaceRecovery?(state: WorkspaceRecoveryUpdate): Promise<void>;
  newWorkspace(
    hasUnsavedChanges: boolean,
    document: LabelDocument,
  ): Promise<WorkspaceLoadResult>;
  openWorkspace(
    hasUnsavedChanges: boolean,
    document: LabelDocument,
  ): Promise<WorkspaceLoadResult>;
  saveWorkspace(document: LabelDocument): Promise<WorkspaceSaveResult>;
  saveWorkspaceAs(document: LabelDocument): Promise<WorkspaceSaveResult>;
  print(request: PrintRequest): Promise<{ readonly message: string }>;
}
