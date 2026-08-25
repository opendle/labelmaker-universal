import { basename, join } from "node:path";

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
  MacOsMakeIdTransportProvider,
  MakeIdE1Adapter,
} from "@labelmaker/adapter-makeid";
import {
  createBlankLabelDocument,
  LABELMAKER_FILE_EXTENSION,
  LabelDocumentError,
  validateLabelDocument,
} from "@labelmaker/documents";
import type { LabelDocument } from "@labelmaker/domain";
import type {
  AdapterContext,
  PrinterAdapter,
  PrinterDescriptor,
  PrinterSession,
} from "@labelmaker/printing";
import { PrinterAdapterRegistry } from "@labelmaker/printing";

import { findConfiguredPrintTarget, printToSession } from "./desktop-print.js";
import { installAppIcon } from "./app-icon.js";
import { renderPlateForPrinter } from "./plate-raster.js";
import { validatePrintRequest } from "./print-request.js";
import {
  initialConfiguredPrinterIds,
  mockPrintersEnabled,
  readConfiguredPrinterIdsWithLegacy,
  writeConfiguredPrinterIds,
} from "./printer-configuration.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace-files.js";
import {
  replacementChoiceFromResponse,
  resolveWorkspaceReplacement,
} from "./workspace-replacement.js";
import { getReadyPrinterSession } from "./printer-session.js";
import { summarizePrinter } from "./printer-summary.js";

const APPLICATION_NAME = "Labelmaker Universal";
app.setName(APPLICATION_NAME);

const registry = new PrinterAdapterRegistry();
const includeMockPrinters = mockPrintersEnabled(
  process.env.LABELMAKER_ENABLE_MOCK_PRINTER,
);
if (includeMockPrinters) registry.register(new MockPrinterAdapter());
if (process.platform === "darwin") {
  registry.register(new MakeIdE1Adapter(new MacOsMakeIdTransportProvider()));
}
let configuredPrinterIds = initialConfiguredPrinterIds([], includeMockPrinters);
const printerSessions = new Map<string, Promise<PrinterSession>>();
const activePrinterJobs = new Set<string>();
const workspacePaths = new Map<number, string>();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
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

async function resolveUnsavedChanges(
  event: IpcMainInvokeEvent,
  hasUnsavedChanges: boolean,
  document: unknown,
) {
  return resolveWorkspaceReplacement(
    hasUnsavedChanges,
    document,
    async () => {
      const options: MessageBoxOptions = {
        type: "warning" as const,
        buttons: ["Save", "Discard changes", "Cancel"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: "Unsaved workspace",
        message: "Save changes to this workspace?",
        detail: "Unsaved changes will be lost if you discard them.",
      };
      const parent = parentWindow(event);
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return replacementChoiceFromResponse(result.response);
    },
    (currentDocument) => saveWorkspace(event, currentDocument, false),
  );
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

async function allDescriptors(
  includeUnpaired = false,
): Promise<readonly PrinterDescriptor[]> {
  const discovered = await Promise.all(
    registry
      .list()
      .map((adapter) =>
        adapter.discover({ timeoutMs: 5_000, includeUnpaired }, context),
      ),
  );
  return discovered.flat();
}

async function summarize(printer: PrinterDescriptor) {
  const adapter = registry.get(printer.adapterId);
  return summarizePrinter(
    printer,
    printerModel(adapter, printer),
    printerSession,
    discardPrinterSession,
    {
      attempts: 1,
      // Listing a paired MakeID printer must not open and retain its exclusive
      // RFCOMM channel. A real session is opened when the user prints. If a
      // print already created a session, this refresh can reuse it.
      probe: printer.adapterId !== "makeid" || printerSessions.has(printer.id),
      onFailure: (error) =>
        context.log.warn("Printer status could not be refreshed", {
          printerId: printer.id,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
    },
  );
}

async function printerSession(
  printer: PrinterDescriptor,
): Promise<PrinterSession> {
  const existing = printerSessions.get(printer.id);
  if (existing) return existing;
  const pending = registry.get(printer.adapterId).connect(printer, context);
  printerSessions.set(printer.id, pending);
  try {
    return await pending;
  } catch (error) {
    printerSessions.delete(printer.id);
    throw error;
  }
}

async function discardPrinterSession(printerId: string): Promise<void> {
  const pending = printerSessions.get(printerId);
  printerSessions.delete(printerId);
  if (!pending) return;
  try {
    await (await pending).close();
  } catch {
    // The transport is already broken. The cached session must still be
    // removed so the next operation can create a fresh connection.
  }
}

/** Return a live session, reconnecting once when macOS dropped the old one. */
async function readyPrinterSession(
  printer: PrinterDescriptor,
): Promise<PrinterSession> {
  return getReadyPrinterSession(printer, printerSession, discardPrinterSession);
}

function discoveredSummary(printer: PrinterDescriptor) {
  const adapter = registry.get(printer.adapterId);
  return {
    id: printer.id,
    adapterId: printer.adapterId,
    name: printer.displayName,
    model: printerModel(adapter, printer),
    transport: printer.transport,
    state: "connecting" as const,
    statusMessage: "Paired",
  };
}

function printerModel(
  adapter: PrinterAdapter,
  printer: PrinterDescriptor,
): string {
  if (printer.adapterId === "makeid") return "MakeID E1";
  return printer.id === "mock-studio"
    ? "MakeID E1 · Mock adapter"
    : `${adapter.manifest.displayName} · Mock adapter`;
}

function registerIpc(): void {
  ipcMain.handle("labelmaker:list-printers", async () => {
    const descriptors = await allDescriptors(false);
    return Promise.all(
      descriptors
        .filter((item) => configuredPrinterIds.has(item.id))
        .map(summarize),
    );
  });

  ipcMain.handle("labelmaker:discover-printers", async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const descriptors = await allDescriptors(true);
    return Promise.all(
      descriptors
        .filter((item) => !configuredPrinterIds.has(item.id))
        .map((printer) =>
          printer.adapterId === "makeid"
            ? discoveredSummary(printer)
            : summarize(printer),
        ),
    );
  });

  ipcMain.handle(
    "labelmaker:add-printer",
    async (_event, printerId: unknown) => {
      if (typeof printerId !== "string")
        throw new TypeError("Printer ID must be a string");
      const descriptors = await allDescriptors(true);
      if (!descriptors.some((item) => item.id === printerId))
        throw new Error("Printer was not found");
      const nextPrinterIds = new Set(configuredPrinterIds).add(printerId);
      const summaries = await Promise.all(
        descriptors
          .filter((item) => nextPrinterIds.has(item.id))
          .map(summarize),
      );
      await writeConfiguredPrinterIds(configuredPrintersPath(), nextPrinterIds);
      configuredPrinterIds.add(printerId);
      return summaries;
    },
  );

  ipcMain.handle(
    "labelmaker:remove-printer",
    async (_event, printerId: unknown) => {
      if (typeof printerId !== "string" || !printerId.trim())
        throw new TypeError("Printer ID must be a non-empty string");
      if (!configuredPrinterIds.has(printerId))
        throw new Error("Printer is not configured");
      if (activePrinterJobs.has(printerId))
        throw new Error("The printer has an active print job");

      const nextPrinterIds = new Set(configuredPrinterIds);
      nextPrinterIds.delete(printerId);
      await writeConfiguredPrinterIds(configuredPrintersPath(), nextPrinterIds);
      configuredPrinterIds = nextPrinterIds;
      await discardPrinterSession(printerId);

      const descriptors = await allDescriptors(false);
      return Promise.all(
        descriptors
          .filter((item) => configuredPrinterIds.has(item.id))
          .map(summarize),
      );
    },
  );

  ipcMain.handle(
    "labelmaker:new-workspace",
    async (event, hasUnsavedChanges: unknown, document: unknown) => {
      assertBoolean(hasUnsavedChanges, "hasUnsavedChanges");
      const resolution = await resolveUnsavedChanges(
        event,
        hasUnsavedChanges,
        document,
      );
      if (resolution.status !== "proceed") return resolution;
      workspacePaths.delete(event.sender.id);
      return {
        status: "created" as const,
        document: createBlankLabelDocument(),
      };
    },
  );

  ipcMain.handle(
    "labelmaker:open-workspace",
    async (event, hasUnsavedChanges: unknown, document: unknown) => {
      assertBoolean(hasUnsavedChanges, "hasUnsavedChanges");
      const resolution = await resolveUnsavedChanges(
        event,
        hasUnsavedChanges,
        document,
      );
      if (resolution.status !== "proceed") return resolution;
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
    const descriptor = findConfiguredPrintTarget(
      await allDescriptors(false),
      configuredPrinterIds,
      validatedRequest.printerId,
    );
    if (activePrinterJobs.has(descriptor.id)) {
      throw new Error("The printer already has an active print job");
    }
    activePrinterJobs.add(descriptor.id);
    let session: PrinterSession | undefined;
    try {
      session = await readyPrinterSession(descriptor);
      return await printToSession(
        validatedRequest,
        descriptor,
        session,
        (plate, target) => renderPlateForPrinter(plate, target, rasterizeSvg),
      );
    } catch (error) {
      printerSessions.delete(descriptor.id);
      await session?.close();
      throw error;
    } finally {
      activePrinterJobs.delete(descriptor.id);
    }
  });
}

function configuredPrintersPath(): string {
  return join(app.getPath("userData"), "configured-printers.json");
}

function legacyConfiguredPrintersPath(): string {
  return join(
    app.getPath("appData"),
    "@labelmaker",
    "desktop",
    "configured-printers.json",
  );
}

async function restoreConfiguredPrinters(): Promise<void> {
  try {
    configuredPrinterIds = initialConfiguredPrinterIds(
      await readConfiguredPrinterIdsWithLegacy(
        configuredPrintersPath(),
        legacyConfiguredPrintersPath(),
      ),
      includeMockPrinters,
    );
  } catch (error) {
    context.log.warn("Saved printer configuration could not be loaded", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    configuredPrinterIds = initialConfiguredPrinterIds([], includeMockPrinters);
  }
}

async function rasterizeSvg(
  svg: string,
  widthPixels: number,
  heightPixels: number,
) {
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  const surface = new BrowserWindow({
    show: false,
    width: widthPixels,
    height: heightPixels,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
    },
  });
  try {
    await surface.loadURL(`data:image/svg+xml;base64,${encoded}`);
    const image = await surface.webContents.capturePage({
      x: 0,
      y: 0,
      width: widthPixels,
      height: heightPixels,
    });
    const resized = image.resize({
      width: widthPixels,
      height: heightPixels,
      quality: "best",
    });
    const bitmap = resized.toBitmap();
    if (bitmap.length !== widthPixels * heightPixels * 4) {
      throw new Error("The label bitmap has an invalid size");
    }
    return {
      widthPixels,
      heightPixels,
      // The SVG uses a white background and black artwork. Channel order does
      // not change those colors at this boundary.
      data: Uint8Array.from(bitmap),
    };
  } finally {
    surface.destroy();
  }
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
    title: APPLICATION_NAME,
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
  void installAppIcon(window).catch((error: unknown) => {
    console.error("Could not install the app icon", error);
  });
  window.webContents.once("destroyed", () => {
    workspacePaths.delete(webContentsId);
  });
  window.once("ready-to-show", () => window.show());
  void window.loadFile(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
  );
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(async () => {
    await restoreConfiguredPrinters();
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

app.on("before-quit", () => {
  for (const pending of printerSessions.values()) {
    void pending.then((session) => session.close()).catch(() => undefined);
  }
  printerSessions.clear();
});
