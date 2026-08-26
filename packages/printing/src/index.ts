export type AdapterId = string;
export type PrinterId = string;

export const MAX_PRINTER_DISPLAY_NAME_LENGTH = 80;

export type PrinterTransport =
  | "bluetooth-classic"
  | "bluetooth-low-energy"
  | "usb"
  | "network"
  | "mock";

export interface AdapterManifest {
  readonly id: AdapterId;
  readonly displayName: string;
  readonly manufacturers: readonly string[];
  readonly transports: readonly PrinterTransport[];
}

export interface PrinterDescriptor {
  readonly id: PrinterId;
  readonly adapterId: AdapterId;
  readonly displayName: string;
  readonly transport: PrinterTransport;
  readonly connection: Readonly<Record<string, unknown>>;
}

export interface MediaSize {
  readonly id: string;
  readonly displayName: string;
  readonly widthMm: number;
  readonly heightMm?: number;
  readonly continuous: boolean;
}

export interface NumericSettingCapability {
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
  readonly defaultValue: number;
}

export interface PrinterCapabilities {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  /** Physical cross-feed width that the print head can reach. */
  readonly printableWidthMm: number;
  /** Default head offset from the top edge of the nominal media. */
  readonly printHeadMarginTopMm?: number;
  /** Default head offset from the bottom edge of the nominal media. */
  readonly printHeadMarginBottomMm?: number;
  readonly darkness?: NumericSettingCapability;
  readonly colorModes: readonly ["monochrome"];
  readonly media: readonly MediaSize[];
  readonly maxCopies: number;
  readonly supportsCut: boolean;
  readonly supportsStatus: boolean;
}

export type PrinterState =
  | "disconnected"
  | "connecting"
  | "ready"
  | "busy"
  | "attention"
  | "error";

export interface PrinterStatus {
  readonly state: PrinterState;
  readonly message?: string;
  readonly batteryPercent?: number;
}

export interface RasterPage {
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly bytesPerRow: number;
  readonly data: Uint8Array;
}

export interface PrintJob {
  readonly id: string;
  readonly printerId: PrinterId;
  readonly pages: readonly RasterPage[];
  readonly copies: number;
  readonly mediaId?: string;
  readonly darkness?: number;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface PrinterSettings {
  readonly displayName?: string;
  readonly darkness?: number;
  readonly printHeadSizeMm?: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
}

export interface PrintProgress {
  readonly completedPages: number;
  readonly totalPages: number;
  readonly message?: string;
}

export interface PrinterSession {
  readonly printer: PrinterDescriptor;
  capabilities(signal?: AbortSignal): Promise<PrinterCapabilities>;
  status(signal?: AbortSignal): Promise<PrinterStatus>;
  print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface DiscoveryOptions {
  readonly timeoutMs: number;
  /** Include compatible devices that are not paired with the local system. */
  readonly includeUnpaired?: boolean;
  readonly signal?: AbortSignal;
}

export interface AdapterContext {
  readonly log: {
    debug(message: string, detail?: Readonly<Record<string, unknown>>): void;
    info(message: string, detail?: Readonly<Record<string, unknown>>): void;
    warn(message: string, detail?: Readonly<Record<string, unknown>>): void;
    error(message: string, detail?: Readonly<Record<string, unknown>>): void;
  };
}

export interface PrinterAdapter {
  readonly manifest: AdapterManifest;
  readonly offlineCapabilities?: Pick<
    PrinterCapabilities,
    "dpi" | "rasterWidthPixels" | "printableWidthMm"
  > &
    Partial<
      Pick<
        PrinterCapabilities,
        "darkness" | "printHeadMarginTopMm" | "printHeadMarginBottomMm"
      >
    >;
  discover(
    options: DiscoveryOptions,
    context: AdapterContext,
  ): Promise<readonly PrinterDescriptor[]>;
  connect(
    printer: PrinterDescriptor,
    context: AdapterContext,
    signal?: AbortSignal,
  ): Promise<PrinterSession>;
}

export class PrinterAdapterRegistry {
  readonly #adapters = new Map<AdapterId, PrinterAdapter>();

  register(adapter: PrinterAdapter): void {
    if (this.#adapters.has(adapter.manifest.id)) {
      throw new Error(
        `Printer adapter is already registered: ${adapter.manifest.id}`,
      );
    }
    this.#adapters.set(adapter.manifest.id, adapter);
  }

  get(adapterId: AdapterId): PrinterAdapter {
    const adapter = this.#adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Printer adapter is not registered: ${adapterId}`);
    }
    return adapter;
  }

  list(): readonly PrinterAdapter[] {
    return [...this.#adapters.values()];
  }
}
