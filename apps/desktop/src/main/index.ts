import { basename } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import { fileURLToPath } from "node:url";

import { MockPrinterAdapter } from "@labelmaker/adapter-mock";
import {
  createBlankLabelDocument,
  LABELMAKER_FILE_EXTENSION,
  LabelDocumentError,
  validateLabelDocument,
} from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";
import type {
  AdapterContext,
  PrinterDescriptor,
  PrinterStatus,
  RasterPage,
} from "@labelmaker/printing";

import { validatePrintRequest } from "./print-request.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace-files.js";

const adapter = new MockPrinterAdapter();
const configuredPrinterIds = new Set(["mock-studio"]);
const workspacePaths = new Map<number, string>();
const context: AdapterContext = {
  log: {
    debug: (message, detail) => console.debug(message, detail ?? {}),
    info: (message, detail) => console.info(message, detail ?? {}),
    warn: (message, detail) => console.warn(message, detail ?? {}),
    error: (message, detail) => console.error(message, detail ?? {}),
  },
};

function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`${name} must be a boolean`);
}

function parentWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

async function confirmDiscard(
  event: IpcMainInvokeEvent,
  hasUnsavedChanges: boolean,
): Promise<boolean> {
  if (!hasUnsavedChanges) return true;
  const options: MessageBoxOptions = {
    type: "warning" as const,
    buttons: ["Cancel", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: "Unsaved workspace",
    message: "Discard the unsaved workspace changes?",
    detail: "This action cannot be undone.",
  };
  const parent = parentWindow(event);
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

function workspaceFailure(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
) {
  if (error instanceof LabelDocumentError) {
    return {
      status: "failed" as const,
      error: { code: error.code, message: error.message, retryable: false },
    };
  }
  return {
    status: "failed" as const,
    error: { code: fallbackCode, message: fallbackMessage, retryable: true },
  };
}

function safeWorkspaceStem(name: string): string {
  const stem = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  return stem || "Untitled workspace";
}

function withWorkspaceExtension(filePath: string): string {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith(LABELMAKER_FILE_EXTENSION)) return filePath;
  const stem = lowerPath.endsWith(".json") ? filePath.slice(0, -5) : filePath;
  return `${stem}${LABELMAKER_FILE_EXTENSION}`;
}

async function selectSavePath(
  event: IpcMainInvokeEvent,
  document: LabelDocument,
): Promise<string | undefined> {
  const options: SaveDialogOptions = {
    title: "Save workspace",
    defaultPath: `${safeWorkspaceStem(document.name)}${LABELMAKER_FILE_EXTENSION}`,
    filters: [
      {
        name: "Labelmaker workspace (*.labelmaker.json)",
        extensions: ["json"],
      },
    ],
    properties: ["showOverwriteConfirmation"],
  };
  const parent = parentWindow(event);
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options);
  return result.canceled || !result.filePath
    ? undefined
    : withWorkspaceExtension(result.filePath);
}

async function saveWorkspace(
  event: IpcMainInvokeEvent,
  value: unknown,
  saveAs: boolean,
) {
  let document: LabelDocument;
  try {
    document = validateLabelDocument(value);
  } catch (error) {
    return workspaceFailure(
      error,
      "INVALID_DOCUMENT",
      "The workspace contains invalid data and cannot be saved.",
    );
  }
  const currentPath = saveAs ? undefined : workspacePaths.get(event.sender.id);
  const filePath = currentPath ?? (await selectSavePath(event, document));
  if (!filePath) return { status: "canceled" as const };
  try {
    await writeWorkspaceFile(filePath, document);
    workspacePaths.set(event.sender.id, filePath);
    return {
      status: "saved" as const,
      savedAt: new Date().toISOString(),
      fileName: basename(filePath),
    };
  } catch (error) {
    return workspaceFailure(
      error,
      "WORKSPACE_WRITE_FAILED",
      `Could not save ${basename(filePath)}. Check the folder permissions and try again.`,
    );
  }
}

async function allDescriptors(): Promise<readonly PrinterDescriptor[]> {
  return adapter.discover({ timeoutMs: 100 }, context);
}

async function summarize(printer: PrinterDescriptor) {
  const session = await adapter.connect(printer, context);
  try {
    const status: PrinterStatus = await session.status();
    return {
      id: printer.id,
      adapterId: printer.adapterId,
      name: printer.displayName,
      model:
        printer.id === "mock-studio"
          ? "MakeID E1 · Mock adapter"
          : "Universal 96 · Mock adapter",
      transport: printer.transport,
      state: status.state,
      statusMessage: status.message ?? status.state,
      ...(status.batteryPercent === undefined
        ? {}
        : { batteryPercent: status.batteryPercent }),
    };
  } finally {
    await session.close();
  }
}

function registerIpc(): void {
  ipcMain.handle("labelmaker:list-printers", async () => {
    const descriptors = await allDescriptors();
    return Promise.all(
      descriptors
        .filter((item) => configuredPrinterIds.has(item.id))
        .map(summarize),
    );
  });

  ipcMain.handle("labelmaker:discover-printers", async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const descriptors = await allDescriptors();
    return Promise.all(
      descriptors
        .filter((item) => !configuredPrinterIds.has(item.id))
        .map(summarize),
    );
  });

  ipcMain.handle(
    "labelmaker:add-printer",
    async (_event, printerId: unknown) => {
      if (typeof printerId !== "string")
        throw new TypeError("Printer ID must be a string");
      const descriptors = await allDescriptors();
      if (!descriptors.some((item) => item.id === printerId))
        throw new Error("Printer was not found");
      configuredPrinterIds.add(printerId);
      return Promise.all(
        descriptors
          .filter((item) => configuredPrinterIds.has(item.id))
          .map(summarize),
      );
    },
  );

  ipcMain.handle(
    "labelmaker:new-workspace",
    async (event, hasUnsavedChanges: unknown) => {
      assertBoolean(hasUnsavedChanges, "hasUnsavedChanges");
      if (!(await confirmDiscard(event, hasUnsavedChanges))) {
        return { status: "canceled" as const };
      }
      workspacePaths.delete(event.sender.id);
      return {
        status: "created" as const,
        document: createBlankLabelDocument(),
      };
    },
  );

  ipcMain.handle(
    "labelmaker:open-workspace",
    async (event, hasUnsavedChanges: unknown) => {
      assertBoolean(hasUnsavedChanges, "hasUnsavedChanges");
      if (!(await confirmDiscard(event, hasUnsavedChanges))) {
        return { status: "canceled" as const };
      }
      const options: OpenDialogOptions = {
        title: "Open workspace",
        filters: [
          {
            name: "Labelmaker workspace (*.labelmaker.json)",
            extensions: ["json"],
          },
        ],
        properties: ["openFile"],
      };
      const parent = parentWindow(event);
      const selection = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      const filePath = selection.filePaths[0];
      if (selection.canceled || !filePath)
        return { status: "canceled" as const };
      try {
        const document = await readWorkspaceFile(filePath);
        workspacePaths.set(event.sender.id, filePath);
        return {
          status: "opened" as const,
          document,
          fileName: basename(filePath),
        };
      } catch (error) {
        return workspaceFailure(
          error,
          "WORKSPACE_READ_FAILED",
          `Could not open ${basename(filePath)}. Check that the file is readable and try again.`,
        );
      }
    },
  );

  ipcMain.handle("labelmaker:save-workspace", (event, document: unknown) =>
    saveWorkspace(event, document, false),
  );

  ipcMain.handle("labelmaker:save-workspace-as", (event, document: unknown) =>
    saveWorkspace(event, document, true),
  );

  ipcMain.handle("labelmaker:print", async (_event, request: unknown) => {
    const validatedRequest = validatePrintRequest(request);
    const descriptor = (await allDescriptors()).find(
      (item) => item.id === validatedRequest.printerId,
    );
    if (!descriptor || !configuredPrinterIds.has(descriptor.id))
      throw new Error("Configured printer was not found");
    const session = await adapter.connect(descriptor, context);
    try {
      const page: RasterPage = {
        widthPixels: 96,
        heightPixels: 64,
        bytesPerRow: 12,
        data: new Uint8Array(12 * 64),
      };
      await session.print({
        id: `mock-job-${Date.now()}`,
        printerId: descriptor.id,
        pages: validatedRequest.plateIds.map(() => page),
        copies: 1,
      });
      const count = validatedRequest.plateIds.length;
      return {
        message: `${count} ${count === 1 ? "label" : "labels"} sent to ${descriptor.displayName}`,
      };
    } finally {
      await session.close();
    }
  });
}

function createWindow(): void {
  const requestedSize =
    process.env.LABELMAKER_WINDOW_SIZE?.split("x").map(Number);
  const width = requestedSize?.[0] ?? 1440;
  const height = requestedSize?.[1] ?? 960;
  const window = new BrowserWindow({
    width,
    height,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: "#efeee9",
    title: "Labelmaker Universal",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
    },
  });
  const webContentsId = window.webContents.id;
  window.webContents.once("destroyed", () => {
    workspacePaths.delete(webContentsId);
  });
  window.once("ready-to-show", () => window.show());
  void window.loadFile(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
  );
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
