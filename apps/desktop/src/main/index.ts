import { basename, join } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from "electron";
import { fileURLToPath } from "node:url";

import { MockPrinterAdapter } from "@labelmaker/adapter-mock";
import { MakeIdE1Adapter } from "@labelmaker/adapter-makeid";
import { MacOsMakeIdTransportProvider } from "@labelmaker/adapter-makeid/macos";
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
  PrinterSettings,
  PrinterSession,
} from "@labelmaker/printing";
import {
  isPrinterSettings,
  PrinterAdapterRegistry,
} from "@labelmaker/printing";
import { renderPlateForPrinter } from "@labelmaker/rendering";

import {
  configuredPrinterDescriptors,
  findConfiguredPrintTarget,
  printToSession,
} from "./desktop-print.js";
import { openPrinterForAddition } from "./printer-addition.js";
import { installAppIcon } from "./app-icon.js";
import { createProcessLogger } from "./process-logger.js";
import { prepareToQuit } from "./quit-coordinator.js";
import { validatePrintRequest } from "./print-request.js";
import { handleSecondInstance } from "./second-instance.js";
import {
  initialConfiguredPrinterIds,
  mockPrintersEnabled,
  normalizePrinterDisplayName,
  readActivePrinterId,
  readConfiguredPrinterIds,
  readConfiguredPrinterIdsWithLegacy,
  readPrinterSettings,
  readSavedPrinterRecords,
  type SavedPrinterRecord,
  writeConfiguredPrinterIds,
} from "./printer-configuration.js";
import { readWorkspaceFile, writeWorkspaceFile } from "./workspace-files.js";
import {
  createWorkspaceRecoveryRecord,
  readWorkspaceRecoveryFile,
  WorkspaceRecoveryStore,
} from "./workspace-recovery.js";
import {
  replacementChoiceFromResponse,
  resolveWorkspaceReplacement,
} from "./workspace-replacement.js";
import {
  getReadyPrinterSession,
  PrinterSessionManager,
} from "./printer-session.js";
import {
  offlineCapabilitiesForPrinter,
  PrinterDiscoveryCache,
  shouldProbePrinterStatus,
  summarizePrinter,
} from "./printer-summary.js";

const APPLICATION_NAME = "Labelmaker";
app.setName(APPLICATION_NAME);
process.title = APPLICATION_NAME;

const registry = new PrinterAdapterRegistry();
const configureMockPrinterFixture = mockPrintersEnabled(
  process.env.LABELMAKER_ENABLE_MOCK_PRINTER,
);
const enableMockPrinterDiscovery = mockPrintersEnabled(
  process.env.LABELMAKER_ENABLE_MOCK_PRINTER_DISCOVERY,
);
if (configureMockPrinterFixture || enableMockPrinterDiscovery) {
  registry.register(new MockPrinterAdapter());
}
if (
  process.platform === "darwin" &&
  process.env.LABELMAKER_DISABLE_HARDWARE_PRINTERS !== "1"
) {
  registry.register(new MakeIdE1Adapter(new MacOsMakeIdTransportProvider()));
}
let configuredPrinterIds = initialConfiguredPrinterIds(
  [],
  configureMockPrinterFixture,
);
let activePrinterId: string | undefined;
const printerSettings = new Map<string, PrinterSettings>();
const savedPrinterRecords = new Map<string, SavedPrinterRecord>();
const printerSessions = new PrinterSessionManager((printer) =>
  registry.get(printer.adapterId).connect(printer, context),
);
const activePrinterJobs = new Set<string>();
const deferredPrinterStatusIds = new Set<string>();
const discoveredPrinters = new PrinterDiscoveryCache();
const workspacePaths = new Map<number, string>();
let workspaceRecoveryStore: WorkspaceRecoveryStore | undefined;
let quitRecoveryFlushed = false;
let quitRecoveryFlushStarted = false;
let developmentRestartRequested = false;
const isDevelopmentLaunch = process.env.LABELMAKER_DEVELOPMENT === "1";
const isScreenshotCapture = process.env.LABELMAKER_SCREENSHOT_MODE === "1";
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const context: AdapterContext = {
  log: createProcessLogger(),
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
  const legacyExtension = ".labelmaker.json";
  const stem = lowerPath.endsWith(legacyExtension)
    ? filePath.slice(0, -legacyExtension.length)
    : filePath;
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
        name: "Labelmaker workspace (*.lbl)",
        extensions: ["lbl"],
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
  const requests = registry
    .list()
    .map((adapter) =>
      adapter.discover({ timeoutMs: 5_000, includeUnpaired }, context),
    );
  if (includeUnpaired) return (await Promise.all(requests)).flat();

  const results = await Promise.allSettled(requests);
  for (const result of results) {
    if (result.status === "rejected") {
      context.log.warn("Routine printer discovery failed", {
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown error",
      });
    }
  }
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

async function summarize(printer: PrinterDescriptor) {
  const adapter = registry.get(printer.adapterId);
  const offlineCapabilities = offlineCapabilitiesForPrinter(adapter, printer);
  const hasActiveJob = activePrinterJobs.has(printer.id);
  const statusIsDeferred = deferredPrinterStatusIds.has(printer.id);
  const shouldProbe =
    !statusIsDeferred &&
    shouldProbePrinterStatus(
      printer.adapterId,
      printerSessions.has(printer.id),
      hasActiveJob,
    );
  return summarizePrinter(
    printer,
    printerModel(adapter, printer),
    printerSession,
    discardPrinterSession,
    {
      attempts: 1,
      // A routine list must not open a MakeID connection. A cached BLE session
      // can provide live status, but a timeout while the printer is off must
      // not close the helper which is waiting to reconnect.
      probe: shouldProbe,
      preserveSessionOnFailure: printer.adapterId === "makeid",
      unprobedState: hasActiveJob ? "busy" : "disconnected",
      unprobedStatusMessage: hasActiveJob ? "Printing" : "Connects on print",
      ...(offlineCapabilities === undefined ? {} : { offlineCapabilities }),
      ...(printerSettings.has(printer.id)
        ? { settings: printerSettings.get(printer.id)! }
        : {}),
      onFailure: (error) => {
        if (printer.adapterId === "makeid") {
          deferredPrinterStatusIds.add(printer.id);
        }
        context.log.warn("Printer status could not be refreshed", {
          printerId: printer.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      },
    },
  );
}

async function printerSession(
  printer: PrinterDescriptor,
): Promise<PrinterSession> {
  return printerSessions.get(printer);
}

async function discardPrinterSession(
  printerId: string,
  expectedSession?: PrinterSession,
): Promise<void> {
  await printerSessions.discard(printerId, expectedSession);
}

/** Return a live session, reconnecting once when macOS dropped the old one. */
async function readyPrinterSession(
  printer: PrinterDescriptor,
): Promise<PrinterSession> {
  return getReadyPrinterSession(printer, printerSession, discardPrinterSession);
}

function discoveredSummary(printer: PrinterDescriptor) {
  const adapter = registry.get(printer.adapterId);
  const offlineCapabilities = offlineCapabilitiesForPrinter(adapter, printer);
  return {
    id: printer.id,
    adapterId: printer.adapterId,
    name: printer.displayName,
    deviceName: printer.displayName,
    model: printerModel(adapter, printer),
    transport: printer.transport,
    state: "connecting" as const,
    statusMessage: "Found nearby",
    ...(offlineCapabilities ?? {}),
    ...(offlineCapabilities?.darkness === undefined
      ? {}
      : {
          darkness: {
            ...offlineCapabilities.darkness,
            value:
              printerSettings.get(printer.id)?.darkness ??
              offlineCapabilities.darkness.defaultValue,
          },
        }),
  };
}

function printerModel(
  adapter: PrinterAdapter,
  printer: PrinterDescriptor,
): string {
  if (printer.adapterId === "makeid") {
    return (
      printer.model ??
      (printer.connection["model"] === "E1" ? "MakeID E1" : "MakeID printer")
    );
  }
  return printer.id === "mock-studio"
    ? "MakeID E1 · Mock adapter"
    : `${adapter.manifest.displayName} · Mock adapter`;
}

function registerIpc(): void {
  ipcMain.handle("labelmaker:load-workspace-recovery", async (event) => {
    if (isScreenshotCapture) return null;
    const recovery = await readWorkspaceRecoveryFile(workspaceRecoveryPath());
    if (!recovery) return null;
    if (recovery.filePath) {
      workspacePaths.set(event.sender.id, recovery.filePath);
    } else {
      workspacePaths.delete(event.sender.id);
    }
    return {
      document: recovery.document,
      dirty: recovery.dirty,
      activePlateId: recovery.activePlateId,
      selectedElementId: recovery.selectedElementId,
      zoom: recovery.zoom,
      savedAt: recovery.savedAt,
      fileName: recovery.filePath ? basename(recovery.filePath) : null,
    };
  });

  ipcMain.handle(
    "labelmaker:store-workspace-recovery",
    (event, value: unknown) => {
      if (isScreenshotCapture) return;
      const recovery = createWorkspaceRecoveryRecord(
        value,
        workspacePaths.get(event.sender.id),
      );
      workspaceRecoveryStore?.update(recovery);
    },
  );

  ipcMain.handle(
    "labelmaker:get-active-printer",
    () => activePrinterId ?? null,
  );

  ipcMain.handle(
    "labelmaker:set-active-printer",
    async (_event, printerId: unknown) => {
      if (typeof printerId !== "string" || !configuredPrinterIds.has(printerId))
        throw new TypeError(
          "Active printer ID must identify a configured printer",
        );
      await writeConfiguredPrinterIds(
        configuredPrintersPath(),
        configuredPrinterIds,
        printerId,
        Object.fromEntries(printerSettings),
        Object.fromEntries(savedPrinterRecords),
      );
      activePrinterId = printerId;
    },
  );

  ipcMain.handle("labelmaker:list-printers", async () => {
    const descriptors = configuredPrinterDescriptors(
      await allDescriptors(false),
      configuredPrinterIds,
      Object.fromEntries(savedPrinterRecords),
    );
    return Promise.all(descriptors.map(summarize));
  });

  ipcMain.handle("labelmaker:discover-printers", async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    const descriptors = await allDescriptors(true);
    discoveredPrinters.replace(descriptors);
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
      // Opening the session completes Bluetooth pairing. Protocol readiness is
      // checked immediately before every print, where a transient status reply
      // can be retried without making the printer impossible to configure.
      const { descriptor, session: connectedSession } =
        await openPrinterForAddition(
          printerId,
          discoveredPrinters,
          () => allDescriptors(true),
          printerSession,
        );
      const resolvedPrinter = connectedSession.printer;
      if (resolvedPrinter.id !== printerId) {
        await printerSessions.discard(printerId, connectedSession);
        throw new Error("The connected printer identity changed");
      }
      const nextPrinterIds = new Set(configuredPrinterIds).add(printerId);
      const nextSavedPrinterRecords = new Map(savedPrinterRecords).set(
        printerId,
        resolvedPrinter,
      );
      try {
        await writeConfiguredPrinterIds(
          configuredPrintersPath(),
          nextPrinterIds,
          activePrinterId,
          Object.fromEntries(printerSettings),
          Object.fromEntries(nextSavedPrinterRecords),
        );
      } catch (error) {
        await printerSessions.discard(printerId, connectedSession);
        throw error;
      }
      configuredPrinterIds.add(printerId);
      savedPrinterRecords.set(printerId, resolvedPrinter);
      discoveredPrinters.delete(printerId);
      const descriptors = configuredPrinterDescriptors(
        [resolvedPrinter, descriptor, ...(await allDescriptors(false))],
        nextPrinterIds,
        Object.fromEntries(nextSavedPrinterRecords),
      );
      return Promise.all(descriptors.map(summarize));
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
      const nextPrinterSettings = new Map(printerSettings);
      nextPrinterSettings.delete(printerId);
      const nextSavedPrinterRecords = new Map(savedPrinterRecords);
      nextSavedPrinterRecords.delete(printerId);
      const nextActivePrinterId =
        activePrinterId === printerId
          ? [...nextPrinterIds].find((id) => id.startsWith("makeid:"))
          : activePrinterId;
      await writeConfiguredPrinterIds(
        configuredPrintersPath(),
        nextPrinterIds,
        nextActivePrinterId,
        Object.fromEntries(nextPrinterSettings),
        Object.fromEntries(nextSavedPrinterRecords),
      );
      activePrinterId = nextActivePrinterId;
      printerSettings.delete(printerId);
      savedPrinterRecords.delete(printerId);
      deferredPrinterStatusIds.delete(printerId);
      configuredPrinterIds = nextPrinterIds;
      await discardPrinterSession(printerId);

      const descriptors = configuredPrinterDescriptors(
        await allDescriptors(false),
        configuredPrinterIds,
        Object.fromEntries(savedPrinterRecords),
      );
      return Promise.all(descriptors.map(summarize));
    },
  );

  ipcMain.handle(
    "labelmaker:update-printer-settings",
    async (_event, printerId: unknown, value: unknown) => {
      if (typeof printerId !== "string" || !configuredPrinterIds.has(printerId))
        throw new TypeError("Printer settings need a configured printer");
      const descriptors = configuredPrinterDescriptors(
        await allDescriptors(false),
        configuredPrinterIds,
        Object.fromEntries(savedPrinterRecords),
      );
      const descriptor = descriptors.find((item) => item.id === printerId);
      if (!descriptor) throw new Error("Configured printer was not found");
      const adapter = registry.get(descriptor.adapterId);
      const darknessCapability = offlineCapabilitiesForPrinter(
        adapter,
        descriptor,
      )?.darkness;
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (key) =>
            ![
              "darkness",
              "displayName",
              "printHeadSizeMm",
              "marginTopMm",
              "marginBottomMm",
              "interLabelSpacingMm",
            ].includes(key),
        )
      ) {
        throw new TypeError("Printer settings are invalid");
      }
      const settings = value as Record<string, unknown>;
      const displayName =
        settings.displayName === undefined
          ? undefined
          : normalizePrinterDisplayName(settings.displayName);
      const darkness = settings.darkness;
      if (
        darkness !== undefined &&
        (darknessCapability === undefined ||
          typeof darkness !== "number" ||
          !Number.isInteger(darkness) ||
          darkness < darknessCapability.minimum ||
          darkness > darknessCapability.maximum)
      ) {
        throw new RangeError("Printer darkness is outside its supported range");
      }
      const geometry = {
        printHeadSizeMm: settings.printHeadSizeMm,
        marginTopMm: settings.marginTopMm,
        marginBottomMm: settings.marginBottomMm,
        interLabelSpacingMm: settings.interLabelSpacingMm,
      };
      if (
        !isPrinterSettings(geometry) ||
        geometry.printHeadSizeMm === undefined ||
        geometry.marginTopMm === undefined ||
        geometry.marginBottomMm === undefined ||
        geometry.interLabelSpacingMm === undefined
      ) {
        throw new RangeError(
          "Printer geometry must use 0.1 mm steps from 0 to 100 mm",
        );
      }
      const updatedSettings: PrinterSettings = {
        ...(displayName === undefined ? {} : { displayName }),
        ...(darkness === undefined ? {} : { darkness }),
        printHeadSizeMm: geometry.printHeadSizeMm,
        marginTopMm: geometry.marginTopMm,
        marginBottomMm: geometry.marginBottomMm,
        interLabelSpacingMm: geometry.interLabelSpacingMm,
      };
      const nextPrinterSettings = new Map(printerSettings).set(
        printerId,
        updatedSettings,
      );
      await writeConfiguredPrinterIds(
        configuredPrintersPath(),
        configuredPrinterIds,
        activePrinterId,
        Object.fromEntries(nextPrinterSettings),
        Object.fromEntries(savedPrinterRecords),
      );
      printerSettings.set(printerId, updatedSettings);
      return Promise.all(descriptors.map(summarize));
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
            name: "Labelmaker workspace (*.lbl)",
            extensions: ["lbl"],
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
      configuredPrinterDescriptors(
        await allDescriptors(false),
        configuredPrinterIds,
        Object.fromEntries(savedPrinterRecords),
      ),
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
      deferredPrinterStatusIds.delete(descriptor.id);
      return await printToSession(
        validatedRequest,
        descriptor,
        session,
        (plate, target) => renderPlateForPrinter(plate, target, rasterizeSvg),
        undefined,
        printerSettings.get(descriptor.id),
      );
    } catch (error) {
      await printerSessions.discard(descriptor.id, session);
      throw error;
    } finally {
      activePrinterJobs.delete(descriptor.id);
    }
  });
}

function configuredPrintersPath(): string {
  return join(app.getPath("userData"), "configured-printers.json");
}

function workspaceRecoveryPath(): string {
  return join(app.getPath("userData"), "workspace-recovery.json");
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
    const storedPrinterIds =
      process.env.LABELMAKER_DISABLE_LEGACY_PRINTER_CONFIGURATION === "1"
        ? await readConfiguredPrinterIds(configuredPrintersPath())
        : await readConfiguredPrinterIdsWithLegacy(
            configuredPrintersPath(),
            legacyConfiguredPrintersPath(),
          );
    configuredPrinterIds = initialConfiguredPrinterIds(
      storedPrinterIds,
      configureMockPrinterFixture,
    );
    activePrinterId = await readActivePrinterId(configuredPrintersPath());
    savedPrinterRecords.clear();
    for (const [printerId, record] of Object.entries(
      await readSavedPrinterRecords(configuredPrintersPath()),
    )) {
      if (configuredPrinterIds.has(printerId)) {
        savedPrinterRecords.set(printerId, record);
      }
    }
    printerSettings.clear();
    for (const [printerId, settings] of Object.entries(
      await readPrinterSettings(configuredPrintersPath()),
    )) {
      if (configuredPrinterIds.has(printerId)) {
        printerSettings.set(printerId, settings);
      }
    }
    if (activePrinterId && !configuredPrinterIds.has(activePrinterId)) {
      activePrinterId = undefined;
    }
  } catch (error) {
    context.log.warn("Saved printer configuration could not be loaded", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    configuredPrinterIds = initialConfiguredPrinterIds(
      [],
      configureMockPrinterFixture,
    );
    activePrinterId = undefined;
    printerSettings.clear();
    savedPrinterRecords.clear();
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
    const rgba = Uint8Array.from(bitmap);
    for (let offset = 0; offset < rgba.length; offset += 4) {
      const blue = rgba[offset] ?? 0;
      rgba[offset] = rgba[offset + 2] ?? 0;
      rgba[offset + 2] = blue;
    }
    return {
      widthPixels,
      heightPixels,
      data: rgba,
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
    minWidth: 600,
    minHeight: 500,
    show: false,
    skipTaskbar: isScreenshotCapture,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1d1f" : "#efeee9",
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
  let recoveryFlushed = false;
  let recoveryCloseStarted = false;
  void installAppIcon(window).catch((error: unknown) => {
    context.log.error("Could not install the app icon", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
  window.webContents.once("destroyed", () => {
    workspacePaths.delete(webContentsId);
  });
  window.on("close", (event) => {
    if (recoveryFlushed || quitRecoveryFlushed || !workspaceRecoveryStore)
      return;
    event.preventDefault();
    if (recoveryCloseStarted) return;
    recoveryCloseStarted = true;
    void workspaceRecoveryStore
      .flush()
      .catch((error: unknown) => {
        context.log.warn("Workspace recovery state could not be saved", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      })
      .finally(() => {
        recoveryFlushed = true;
        window.destroy();
      });
  });
  window.once("ready-to-show", () => {
    if (!isScreenshotCapture) window.show();
  });
  void window.loadFile(
    fileURLToPath(new URL("../renderer/index.html", import.meta.url)),
  );
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    handleSecondInstance({
      development: isDevelopmentLaunch && !developmentRestartRequested,
      focusCurrentWindow: () => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
      },
      quit: () => app.quit(),
      relaunch: () => {
        developmentRestartRequested = true;
        app.relaunch();
      },
    });
  });

  app.whenReady().then(async () => {
    if (isScreenshotCapture && process.platform === "darwin") app.dock?.hide();
    await restoreConfiguredPrinters();
    workspaceRecoveryStore = new WorkspaceRecoveryStore(
      workspaceRecoveryPath(),
      (error) => {
        context.log.warn("Workspace recovery state could not be saved", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      },
    );
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

app.on("before-quit", (event) => {
  if (quitRecoveryFlushed) return;
  const recoveryStore = workspaceRecoveryStore;
  if (!recoveryStore) {
    void printerSessions.closeAll().catch((error) => {
      context.log.warn("Printer sessions could not be closed cleanly", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
    return;
  }
  event.preventDefault();
  if (quitRecoveryFlushStarted) return;
  quitRecoveryFlushStarted = true;
  prepareToQuit({
    closePrinters: () => printerSessions.closeAll(),
    flushRecovery: () => recoveryStore.flush(),
    onPrinterCloseError: (error) => {
      context.log.warn("Printer sessions could not be closed cleanly", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    },
    onRecoveryError: (error) => {
      context.log.warn("Workspace recovery state could not be saved", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    },
    readyToQuit: () => {
      quitRecoveryFlushed = true;
      // The first quit event was canceled for the recovery flush. Exit after
      // that flush because a nested app.quit() can leave macOS without a
      // second effective quit event.
      app.exit(0);
    },
  });
});
