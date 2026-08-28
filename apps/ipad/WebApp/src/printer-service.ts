import { MakeIdE1Adapter } from "@labelmaker/adapter-makeid";
import { validateLabelDocument } from "@labelmaker/documents";
import type { LabelPlate } from "@labelmaker/domain";
import {
  PrinterAdapterRegistry,
  type AdapterContext,
  type PrinterAdapter,
  type PrinterDescriptor,
  type PrinterSession,
} from "@labelmaker/printing";
import { renderPlateForPrinter } from "@labelmaker/rendering";
import type {
  PrinterSettings,
  PrinterSummary,
  PrintRequest,
} from "@labelmaker/ui";

import { IpadMakeIdTransportProvider } from "./ipad-makeid-transport.js";
import {
  readStoredPrinterSettings,
  validatePrinterSettings,
} from "./printer-settings.js";

const CONFIGURATION_KEY = "labelmaker.ipados.printers.v1";
const registry = new PrinterAdapterRegistry();
registry.register(new MakeIdE1Adapter(new IpadMakeIdTransportProvider()));

const context: AdapterContext = {
  log: {
    debug: (message, detail) => console.debug(message, detail ?? {}),
    info: (message, detail) => console.info(message, detail ?? {}),
    warn: (message, detail) => console.warn(message, detail ?? {}),
    error: (message, detail) => console.error(message, detail ?? {}),
  },
};

interface StoredConfiguration {
  readonly printerIds: readonly string[];
  readonly activePrinterId: string | null;
  readonly settings: Readonly<Record<string, PrinterSettings>>;
}

export class IpadPrinterService {
  readonly #sessions = new Map<string, Promise<PrinterSession>>();
  readonly #discovered = new Map<string, PrinterDescriptor>();
  #configuration = loadConfiguration();

  async listPrinters(): Promise<readonly PrinterSummary[]> {
    return Promise.all(
      this.configuredDescriptors().map((descriptor) =>
        this.summarize(descriptor),
      ),
    );
  }

  async discoverPrinters(): Promise<readonly PrinterSummary[]> {
    const results = await Promise.allSettled(
      registry
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
    if (descriptor.adapterId === "makeid") {
      const session = await this.session(descriptor);
      const status = await session.status();
      if (status.state !== "ready") {
        await this.discardSession(descriptor.id);
        throw new Error(status.message ?? "The printer is not ready.");
      }
    }
    this.#configuration = {
      ...this.#configuration,
      printerIds: [...new Set([...this.#configuration.printerIds, printerId])],
      activePrinterId: printerId,
    };
    this.storeConfiguration();
    return this.listPrinters();
  }

  async removePrinter(printerId: string): Promise<readonly PrinterSummary[]> {
    if (!this.#configuration.printerIds.includes(printerId)) {
      throw new Error("Printer is not configured.");
    }
    await this.discardSession(printerId);
    const printerIds = this.#configuration.printerIds.filter(
      (id) => id !== printerId,
    );
    const { [printerId]: _removed, ...settings } = this.#configuration.settings;
    this.#configuration = {
      printerIds,
      activePrinterId:
        this.#configuration.activePrinterId === printerId
          ? (printerIds[0] ?? null)
          : this.#configuration.activePrinterId,
      settings,
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
    const session = await this.session(descriptor);
    try {
      const [capabilities, status] = await Promise.all([
        session.capabilities(),
        session.status(),
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
      await session.print({
        id: `ipados-${crypto.randomUUID()}`,
        printerId: descriptor.id,
        pages,
        copies: 1,
        ...(settings.darkness === undefined
          ? {}
          : { darkness: settings.darkness }),
      });
      return {
        message: `${pages.length} ${pages.length === 1 ? "label" : "labels"} sent to ${settings.displayName ?? descriptor.displayName}`,
      };
    } catch (error) {
      await this.discardSession(descriptor.id);
      throw error;
    }
  }

  private configuredDescriptors(): readonly PrinterDescriptor[] {
    return this.#configuration.printerIds.flatMap((printerId) => {
      const discovered = this.#discovered.get(printerId);
      if (discovered) return [discovered];
      if (!printerId.startsWith("makeid:ipad-ble-")) return [];
      const deviceId = printerId.slice("makeid:".length);
      return [
        {
          id: printerId,
          adapterId: "makeid",
          displayName: "MakeID E1",
          transport: "bluetooth-low-energy" as const,
          connection: { model: "E1", transportDeviceId: deviceId },
        },
      ];
    });
  }

  private async summarize(
    descriptor: PrinterDescriptor,
  ): Promise<PrinterSummary> {
    const adapter = registry.get(descriptor.adapterId);
    const settings = this.#configuration.settings[descriptor.id] ?? {};
    const base = {
      id: descriptor.id,
      adapterId: descriptor.adapterId,
      deviceName: descriptor.displayName,
      name: settings.displayName ?? descriptor.displayName,
      model: "E1",
      transport: descriptor.transport,
    };
    return {
      ...base,
      state: "disconnected",
      statusMessage: "Connects on print",
      ...capabilityFields(adapter.offlineCapabilities, settings),
    };
  }

  private session(descriptor: PrinterDescriptor): Promise<PrinterSession> {
    const existing = this.#sessions.get(descriptor.id);
    if (existing) return existing;
    const pending = registry
      .get(descriptor.adapterId)
      .connect(descriptor, context);
    this.#sessions.set(descriptor.id, pending);
    void pending.catch(() => {
      if (this.#sessions.get(descriptor.id) === pending)
        this.#sessions.delete(descriptor.id);
    });
    return pending;
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
      CONFIGURATION_KEY,
      JSON.stringify(this.#configuration),
    );
  }
}

function capabilityFields(
  capabilities: PrinterAdapter["offlineCapabilities"],
  settings: PrinterSettings,
): Partial<PrinterSummary> {
  if (!capabilities) return {};
  return {
    dpi: capabilities.dpi,
    rasterWidthPixels: capabilities.rasterWidthPixels,
    printableWidthMm: settings.printHeadSizeMm ?? capabilities.printableWidthMm,
    marginTopMm: settings.marginTopMm ?? capabilities.printHeadMarginTopMm ?? 0,
    marginBottomMm:
      settings.marginBottomMm ?? capabilities.printHeadMarginBottomMm ?? 0,
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
  return renderPlateForPrinter(plate, target, rasterizeSvg);
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

function loadConfiguration(): StoredConfiguration {
  const fallback: StoredConfiguration = {
    printerIds: [],
    activePrinterId: null,
    settings: {},
  };
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(CONFIGURATION_KEY) ?? "null",
    );
    if (!isRecord(value) || !Array.isArray(value.printerIds)) return fallback;
    const printerIds = value.printerIds.filter(
      (item): item is string =>
        typeof item === "string" &&
        item.startsWith("makeid:ipad-ble-") &&
        item.length <= 300,
    );
    return {
      printerIds: [...new Set(printerIds)],
      activePrinterId:
        typeof value.activePrinterId === "string" &&
        printerIds.includes(value.activePrinterId)
          ? value.activePrinterId
          : null,
      settings: readStoredPrinterSettings(value.settings, printerIds),
    };
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
