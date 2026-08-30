import { makeIdProfileId, MakeIdAdapter } from "@labelmaker/adapter-makeid";
import { validateLabelDocument } from "@labelmaker/documents";
import type { LabelPlate } from "@labelmaker/domain";
import {
  addInterLabelSpacing,
  type OfflinePrinterCapabilities,
  PrinterAdapterRegistry,
  type AdapterContext,
  type PrinterDescriptor,
  type PrinterSession,
} from "@labelmaker/printing";
import { renderPlateForPrinter } from "@labelmaker/rendering";
import type {
  PrinterSettings,
  PrinterSummary,
  PrintRequest,
} from "@labelmaker/ui";

import { MobileMakeIdTransportProvider } from "./mobile-makeid-transport.js";
import type { NativeBridge } from "./native-bridge.js";
import {
  readStoredPrinterSettings,
  validatePrinterSettings,
} from "./printer-settings.js";

const context: AdapterContext = {
  log: {
    debug: (message, detail) => console.debug(message, detail ?? {}),
    info: (message, detail) => console.info(message, detail ?? {}),
    warn: (message, detail) => console.warn(message, detail ?? {}),
    error: (message, detail) => console.error(message, detail ?? {}),
  },
};

interface StoredConfiguration {
  readonly version: 2;
  readonly printerIds: readonly string[];
  readonly activePrinterId: string | null;
  readonly settings: Readonly<Record<string, PrinterSettings>>;
  /** Keep the adapter-confirmed profile. An L1 name does not identify its DPI. */
  readonly printerRecords: Readonly<Record<string, PrinterDescriptor>>;
}

export class MobilePrinterService {
  readonly #sessions = new Map<string, Promise<PrinterSession>>();
  readonly #discovered = new Map<string, PrinterDescriptor>();
  readonly #registry = new PrinterAdapterRegistry();
  readonly #transportProvider: MobileMakeIdTransportProvider;
  #configuration: StoredConfiguration;
  #activePrint:
    | {
        readonly controller: AbortController;
        readonly completion: Promise<void>;
        complete(): void;
      }
    | undefined;

  constructor(
    bridge: NativeBridge,
    private readonly configurationKey: string,
    private readonly jobIdPrefix: string,
  ) {
    this.#transportProvider = new MobileMakeIdTransportProvider(bridge);
    this.#registry.register(new MakeIdAdapter(this.#transportProvider));
    this.#configuration = loadConfiguration(configurationKey);
  }

  async listPrinters(): Promise<readonly PrinterSummary[]> {
    return Promise.all(
      this.configuredDescriptors().map((descriptor) =>
        this.summarize(descriptor),
      ),
    );
  }

  async discoverPrinters(): Promise<readonly PrinterSummary[]> {
    // CoreBluetooth discovery and a configured-printer session share one
    // native transport. Release the cached session before a new scan.
    await this.discardSessions();
    const results = await Promise.allSettled(
      this.#registry
        .list()
        .map((adapter) =>
          adapter.discover(
            { timeoutMs: 5_000, includeUnpaired: true },
            context,
          ),
        ),
    );
    if (results.every((result) => result.status === "rejected")) {
      const failure = results.find((result) => result.status === "rejected");
      throw failure?.reason instanceof Error
        ? failure.reason
        : new Error("Printer discovery failed.");
    }
    const descriptors = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    this.#discovered.clear();
    for (const descriptor of descriptors)
      this.#discovered.set(descriptor.id, descriptor);
    return Promise.all(
      descriptors.map((descriptor) => this.summarize(descriptor)),
    );
  }

  async addPrinter(printerId: string): Promise<readonly PrinterSummary[]> {
    const descriptor = this.#discovered.get(printerId);
    if (!descriptor)
      throw new Error("The selected printer is no longer available.");
    let configuredDescriptor = descriptor;
    if (descriptor.adapterId === "makeid") {
      try {
        const session = await this.session(descriptor);
        const status = await session.status();
        if (status.state !== "ready") {
          throw new Error(status.message ?? "The printer is not ready.");
        }
        configuredDescriptor = session.printer;
        this.#discovered.set(printerId, configuredDescriptor);
      } finally {
        // The native iPad transport owns one CoreBluetooth connection. Close
        // the probe so another Add Printer scan can start. Android and Windows
        // transports can use the same short probe-and-store model.
        await this.discardSession(descriptor.id);
      }
    }
    const storedDescriptor = readStoredMakeIdDescriptor(
      configuredDescriptor,
      printerId,
    );
    if (!storedDescriptor) {
      await this.discardSession(printerId);
      throw new Error("The MakeID printer model could not be identified.");
    }
    await this.#transportProvider.preserveDevice(
      storedDescriptor.connection.transportDeviceId as string,
    );
    this.#configuration = {
      ...this.#configuration,
      printerIds: [...new Set([...this.#configuration.printerIds, printerId])],
      activePrinterId: printerId,
      printerRecords: {
        ...this.#configuration.printerRecords,
        [printerId]: storedDescriptor,
      },
    };
    this.storeConfiguration();
    return this.listPrinters();
  }

  async removePrinter(printerId: string): Promise<readonly PrinterSummary[]> {
    if (!this.#configuration.printerIds.includes(printerId)) {
      throw new Error("Printer is not configured.");
    }
    await this.discardSession(printerId);
    const storedDescriptor = this.#configuration.printerRecords[printerId];
    if (storedDescriptor && isRecord(storedDescriptor.connection)) {
      const deviceId = storedDescriptor.connection.transportDeviceId;
      if (typeof deviceId === "string") {
        await this.#transportProvider.releaseDevice(deviceId);
      }
    }
    const printerIds = this.#configuration.printerIds.filter(
      (id) => id !== printerId,
    );
    const { [printerId]: _removed, ...settings } = this.#configuration.settings;
    const { [printerId]: _removedRecord, ...printerRecords } =
      this.#configuration.printerRecords;
    this.#configuration = {
      version: 2,
      printerIds,
      activePrinterId:
        this.#configuration.activePrinterId === printerId
          ? (printerIds[0] ?? null)
          : this.#configuration.activePrinterId,
      settings,
      printerRecords,
    };
    this.storeConfiguration();
    return this.listPrinters();
  }

  getActivePrinterId(): string | null {
    return this.#configuration.activePrinterId;
  }

  setActivePrinterId(printerId: string): void {
    if (!this.#configuration.printerIds.includes(printerId)) {
      throw new Error("The active printer must be configured.");
    }
    this.#configuration = {
      ...this.#configuration,
      activePrinterId: printerId,
    };
    this.storeConfiguration();
  }

  async updatePrinterSettings(
    printerId: string,
    settings: PrinterSettings,
  ): Promise<readonly PrinterSummary[]> {
    if (!this.#configuration.printerIds.includes(printerId)) {
      throw new Error("Printer settings need a configured printer.");
    }
    const validatedSettings = validatePrinterSettings(settings);
    const descriptor = this.configuredDescriptors().find(
      (candidate) => candidate.id === printerId,
    );
    if (!descriptor) throw new Error("The configured printer was not found.");
    const adapter = this.#registry.get(descriptor.adapterId);
    const offlineCapabilities =
      adapter.offlineCapabilitiesFor?.(descriptor) ??
      adapter.offlineCapabilities;
    if (
      validatedSettings.darkness !== undefined &&
      offlineCapabilities?.darkness === undefined
    ) {
      throw new RangeError("This printer does not support a darkness setting.");
    }
    this.#configuration = {
      ...this.#configuration,
      settings: {
        ...this.#configuration.settings,
        [printerId]: validatedSettings,
      },
    };
    this.storeConfiguration();
    return this.listPrinters();
  }

  async print(request: PrintRequest): Promise<{ readonly message: string }> {
    if (this.#activePrint) {
      throw new Error("A print job is already active.");
    }
    const controller = new AbortController();
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const activePrint = { controller, completion, complete };
    this.#activePrint = activePrint;
    try {
      return await this.runPrint(request, controller.signal);
    } finally {
      if (this.#activePrint === activePrint) this.#activePrint = undefined;
      complete();
    }
  }

  async cancelPrint(): Promise<void> {
    const activePrint = this.#activePrint;
    if (!activePrint) return;
    activePrint.controller.abort();
    await activePrint.completion;
  }

  async resetNativeConnections(): Promise<void> {
    await this.discardSessions();
  }

  private async runPrint(
    request: PrintRequest,
    signal: AbortSignal,
  ): Promise<{ readonly message: string }> {
    const document = validateLabelDocument(request.document);
    const descriptor = this.configuredDescriptors().find(
      (candidate) => candidate.id === request.printerId,
    );
    if (!descriptor) throw new Error("The configured printer was not found.");
    const plateIds = [...new Set(request.plateIds)];
    if (plateIds.length === 0)
      throw new Error("Select at least one plate to print.");
    const plates = plateIds.map((plateId) => {
      const plate = document.plates.find(
        (candidate) => candidate.id === plateId,
      );
      if (!plate) throw new Error("A selected plate was not found.");
      return plate;
    });
    const session = await this.session(descriptor, signal);
    try {
      const [capabilities, status] = await Promise.all([
        session.capabilities(signal),
        session.status(signal),
      ]);
      if (status.state !== "ready")
        throw new Error(status.message ?? "The printer is not ready.");
      const settings = this.#configuration.settings[descriptor.id] ?? {};
      const printableWidthMm =
        settings.printHeadSizeMm ?? capabilities.printableWidthMm;
      const pages = await Promise.all(
        plates.map((plate) =>
          renderPlate(plate, {
            dpi: capabilities.dpi,
            rasterWidthPixels: capabilities.rasterWidthPixels,
            printableWidthMm,
            rasterAlignment: capabilities.rasterAlignment,
            ...((settings.marginTopMm ?? capabilities.printHeadMarginTopMm) ===
            undefined
              ? {}
              : {
                  marginTopMm:
                    settings.marginTopMm ?? capabilities.printHeadMarginTopMm,
                }),
            ...((settings.marginBottomMm ??
              capabilities.printHeadMarginBottomMm) === undefined
              ? {}
              : {
                  marginBottomMm:
                    settings.marginBottomMm ??
                    capabilities.printHeadMarginBottomMm,
                }),
          }),
        ),
      );
      await session.print(
        {
          id: `${this.jobIdPrefix}-${crypto.randomUUID()}`,
          printerId: descriptor.id,
          pages: addInterLabelSpacing(
            pages,
            settings.interLabelSpacingMm ?? 1,
            capabilities.dpi,
          ),
          copies: 1,
          ...(settings.darkness === undefined ||
          capabilities.darkness === undefined
            ? {}
            : { darkness: settings.darkness }),
        },
        undefined,
        signal,
      );
      return {
        message: `${pages.length} ${pages.length === 1 ? "label" : "labels"} sent to ${settings.displayName ?? descriptor.displayName}`,
      };
    } catch (error) {
      // A failed command stream can contain a late reply. Discard it so the
      // next print must use a clean connection.
      await this.discardSession(descriptor.id);
      throw error;
    }
  }

  private configuredDescriptors(): readonly PrinterDescriptor[] {
    return this.#configuration.printerIds.flatMap((printerId) => {
      const stored = this.#configuration.printerRecords[printerId];
      if (stored) return [stored];
      const discovered = this.#discovered.get(printerId);
      if (discovered) return [discovered];
      return [];
    });
  }

  private async summarize(
    descriptor: PrinterDescriptor,
  ): Promise<PrinterSummary> {
    const adapter = this.#registry.get(descriptor.adapterId);
    const settings = this.#configuration.settings[descriptor.id] ?? {};
    const base = {
      id: descriptor.id,
      adapterId: descriptor.adapterId,
      deviceName: descriptor.displayName,
      name: settings.displayName ?? descriptor.displayName,
      model: descriptor.model ?? descriptor.displayName,
      transport: descriptor.transport,
    };
    return {
      ...base,
      state: "disconnected",
      statusMessage: "Connects on print",
      ...capabilityFields(
        adapter.offlineCapabilitiesFor?.(descriptor) ??
          adapter.offlineCapabilities,
        settings,
      ),
    };
  }

  private async session(
    descriptor: PrinterDescriptor,
    signal?: AbortSignal,
  ): Promise<PrinterSession> {
    const existing = this.#sessions.get(descriptor.id);
    if (existing) return existing;

    // The native mobile transport owns one CoreBluetooth connection. Close a
    // session for another printer before this connection starts.
    await this.discardSessions(descriptor.id);
    const concurrent = this.#sessions.get(descriptor.id);
    if (concurrent) return concurrent;

    const pending = this.#registry
      .get(descriptor.adapterId)
      .connect(descriptor, context, signal)
      .then((session) => {
        if (this.#configuration.printerIds.includes(descriptor.id)) {
          this.rememberResolvedPrinter(session.printer);
        }
        return session;
      });
    this.#sessions.set(descriptor.id, pending);
    void pending.catch(() => {
      if (this.#sessions.get(descriptor.id) === pending)
        this.#sessions.delete(descriptor.id);
    });
    return pending;
  }

  private async discardSessions(exceptPrinterId?: string): Promise<void> {
    await Promise.all(
      [...this.#sessions.keys()]
        .filter((printerId) => printerId !== exceptPrinterId)
        .map((printerId) => this.discardSession(printerId)),
    );
  }

  private async discardSession(printerId: string): Promise<void> {
    const pending = this.#sessions.get(printerId);
    this.#sessions.delete(printerId);
    if (!pending) return;
    try {
      await (await pending).close();
    } catch {
      // A broken Bluetooth session still needs to leave the cache.
    }
  }

  private storeConfiguration(): void {
    localStorage.setItem(
      this.configurationKey,
      JSON.stringify(this.#configuration),
    );
  }

  private rememberResolvedPrinter(descriptor: PrinterDescriptor): void {
    const storedDescriptor = readStoredMakeIdDescriptor(
      descriptor,
      descriptor.id,
    );
    if (!storedDescriptor) return;
    this.#configuration = {
      ...this.#configuration,
      printerRecords: {
        ...this.#configuration.printerRecords,
        [descriptor.id]: storedDescriptor,
      },
    };
    this.storeConfiguration();
  }
}

function capabilityFields(
  capabilities: OfflinePrinterCapabilities | undefined,
  settings: PrinterSettings,
): Partial<PrinterSummary> {
  if (!capabilities) return {};
  return {
    dpi: capabilities.dpi,
    rasterWidthPixels: capabilities.rasterWidthPixels,
    printableWidthMm: settings.printHeadSizeMm ?? capabilities.printableWidthMm,
    rasterAlignment: capabilities.rasterAlignment,
    marginTopMm: settings.marginTopMm ?? capabilities.printHeadMarginTopMm ?? 0,
    marginBottomMm:
      settings.marginBottomMm ?? capabilities.printHeadMarginBottomMm ?? 0,
    interLabelSpacingMm: settings.interLabelSpacingMm ?? 1,
    ...(capabilities.darkness
      ? {
          darkness: {
            ...capabilities.darkness,
            value: settings.darkness ?? capabilities.darkness.defaultValue,
          },
        }
      : {}),
  };
}

async function renderPlate(
  plate: LabelPlate,
  target: Parameters<typeof renderPlateForPrinter>[1],
) {
  return renderPlateForPrinter(
    plate,
    target,
    rasterizeSvg,
    rasterizeImageFrame,
  );
}

async function rasterizeImageFrame(
  element: Extract<LabelPlate["elements"][number], { readonly kind: "image" }>,
  widthPixels: number,
  heightPixels: number,
) {
  const image = new Image();
  image.src = element.source;
  await image.decode();
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    throw new Error("The print image has invalid dimensions.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = widthPixels;
  canvas.height = heightPixels;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The print canvas is not available.");
  context.fillStyle = "white";
  context.fillRect(0, 0, widthPixels, heightPixels);
  const sourceAspect = image.naturalWidth / image.naturalHeight;
  const targetAspect = widthPixels / heightPixels;
  let drawWidth = widthPixels;
  let drawHeight = heightPixels;
  if (element.fit === "contain") {
    if (sourceAspect > targetAspect) drawHeight = widthPixels / sourceAspect;
    else drawWidth = heightPixels * sourceAspect;
  } else if (element.fit === "cover") {
    if (sourceAspect > targetAspect) drawWidth = heightPixels * sourceAspect;
    else drawHeight = widthPixels / sourceAspect;
  }
  context.drawImage(
    image,
    (widthPixels - drawWidth) / 2,
    (heightPixels - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  return {
    widthPixels,
    heightPixels,
    data: context.getImageData(0, 0, widthPixels, heightPixels).data,
  };
}

async function rasterizeSvg(
  svg: string,
  widthPixels: number,
  heightPixels: number,
) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = widthPixels;
    canvas.height = heightPixels;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("The print canvas is not available.");
    context.fillStyle = "white";
    context.fillRect(0, 0, widthPixels, heightPixels);
    context.drawImage(image, 0, 0, widthPixels, heightPixels);
    return {
      widthPixels,
      heightPixels,
      data: context.getImageData(0, 0, widthPixels, heightPixels).data,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadConfiguration(configurationKey: string): StoredConfiguration {
  const fallback: StoredConfiguration = {
    version: 2,
    printerIds: [],
    activePrinterId: null,
    settings: {},
    printerRecords: {},
  };
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(configurationKey) ?? "null",
    );
    if (!isRecord(value) || !Array.isArray(value.printerIds)) return fallback;
    const candidatePrinterIds = value.printerIds.filter(
      (item): item is string =>
        typeof item === "string" &&
        item.startsWith("makeid:") &&
        item.length > "makeid:".length &&
        item.length <= 300,
    );
    const printerRecords: Record<string, PrinterDescriptor> = {};
    if (value.version === 2) {
      if (!isRecord(value.printerRecords)) return fallback;
      for (const printerId of candidatePrinterIds) {
        const descriptor = readStoredMakeIdDescriptor(
          value.printerRecords[printerId],
          printerId,
        );
        if (descriptor) printerRecords[printerId] = descriptor;
      }
    } else if (value.version === undefined || value.version === 1) {
      for (const printerId of candidatePrinterIds) {
        printerRecords[printerId] = legacyE1Descriptor(printerId);
      }
    } else {
      return fallback;
    }
    const printerIds = candidatePrinterIds.filter(
      (printerId) => printerRecords[printerId] !== undefined,
    );
    return {
      version: 2,
      printerIds: [...new Set(printerIds)],
      activePrinterId:
        typeof value.activePrinterId === "string" &&
        printerIds.includes(value.activePrinterId)
          ? value.activePrinterId
          : null,
      settings: readStoredPrinterSettings(value.settings, printerIds),
      printerRecords,
    };
  } catch {
    return fallback;
  }
}

function legacyE1Descriptor(printerId: string): PrinterDescriptor {
  return {
    id: printerId,
    adapterId: "makeid",
    displayName: "MakeID E1",
    model: "MakeID E1",
    transport: "bluetooth-low-energy",
    connection: {
      model: "E1",
      transportDeviceId: printerId.slice("makeid:".length),
    },
  };
}

function readStoredMakeIdDescriptor(
  value: unknown,
  printerId: string,
): PrinterDescriptor | undefined {
  if (!isRecord(value) || !isRecord(value.connection)) return undefined;
  const connection = value.connection;
  if (
    value.id !== printerId ||
    value.adapterId !== "makeid" ||
    typeof value.displayName !== "string" ||
    value.displayName.length === 0 ||
    value.displayName.length > 80 ||
    typeof value.model !== "string" ||
    value.model.length === 0 ||
    value.model.length > 80 ||
    value.transport !== "bluetooth-low-energy" ||
    typeof connection.transportDeviceId !== "string" ||
    connection.transportDeviceId !== printerId.slice("makeid:".length) ||
    !makeIdProfileId(connection.profileId) ||
    (connection.advertisedName !== undefined &&
      (typeof connection.advertisedName !== "string" ||
        connection.advertisedName.length > 80))
  ) {
    return undefined;
  }
  return {
    id: printerId,
    adapterId: "makeid",
    displayName: value.displayName,
    model: value.model,
    transport: "bluetooth-low-energy",
    connection: {
      transportDeviceId: connection.transportDeviceId,
      profileId: connection.profileId,
      ...(typeof connection.advertisedName === "string"
        ? { advertisedName: connection.advertisedName }
        : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
