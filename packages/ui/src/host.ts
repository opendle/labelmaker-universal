import type { LabelDocument } from "@labelmaker/domain";
import type { PrinterState, PrinterTransport } from "@labelmaker/printing";

export interface PrinterSummary {
  readonly id: string;
  readonly adapterId: string;
  readonly name: string;
  readonly model: string;
  readonly transport: PrinterTransport;
  readonly state: PrinterState;
  readonly statusMessage: string;
  readonly batteryPercent?: number;
}

export interface PrintRequest {
  readonly document: LabelDocument;
  readonly printerId: string;
  readonly plateIds: readonly string[];
}

export type HostPlatform = "macos" | "windows" | "linux";

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
