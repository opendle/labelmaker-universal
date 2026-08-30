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
  /** Adapter-confirmed hardware model. Discovery can omit it until probing. */
  readonly model?: string;
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

/** Cross-feed position of media that is narrower than the print head. */
export type RasterAlignment = "start" | "center" | "end";

export interface PrinterCapabilities {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  /** Physical cross-feed width that the print head can reach. */
  readonly printableWidthMm: number;
  /** Position of the media across the physical print head. */
  readonly rasterAlignment: RasterAlignment;
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

export type OfflinePrinterCapabilities = Pick<
  PrinterCapabilities,
  "dpi" | "rasterWidthPixels" | "printableWidthMm" | "rasterAlignment"
> &
  Partial<
    Pick<
      PrinterCapabilities,
      "darkness" | "printHeadMarginTopMm" | "printHeadMarginBottomMm"
    >
  >;

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
  /** Omit this value to show the unchanged device name. */
  readonly displayName?: string;
  readonly darkness?: number;
  readonly printHeadSizeMm?: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
  readonly interLabelSpacingMm?: number;
}

const PRINTER_SETTING_KEYS = new Set([
  "displayName",
  "darkness",
  "printHeadSizeMm",
  "marginTopMm",
  "marginBottomMm",
  "interLabelSpacingMm",
]);

export function isPrinterSettings(value: unknown): value is PrinterSettings {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => PRINTER_SETTING_KEYS.has(key)) &&
    (!("displayName" in value) ||
      (typeof value.displayName === "string" &&
        value.displayName === value.displayName.trim() &&
        value.displayName.length > 0 &&
        value.displayName.length <= MAX_PRINTER_DISPLAY_NAME_LENGTH)) &&
    (!("darkness" in value) ||
      (typeof value.darkness === "number" &&
        Number.isInteger(value.darkness) &&
        value.darkness >= 0 &&
        value.darkness <= 31)) &&
    (!("printHeadSizeMm" in value) ||
      isTenthMillimeter(value.printHeadSizeMm, 0.1)) &&
    (!("marginTopMm" in value) || isTenthMillimeter(value.marginTopMm, 0)) &&
    (!("marginBottomMm" in value) ||
      isTenthMillimeter(value.marginBottomMm, 0)) &&
    (!("interLabelSpacingMm" in value) ||
      isTenthMillimeter(value.interLabelSpacingMm, 0))
  );
}

function isTenthMillimeter(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= 100 &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-8
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Add white feed rows between raster pages without changing their width. */
export function addInterLabelSpacing(
  pages: readonly RasterPage[],
  spacingMm: number,
  dpi: number,
): readonly RasterPage[] {
  if (
    !Number.isFinite(spacingMm) ||
    spacingMm < 0 ||
    !Number.isFinite(dpi) ||
    dpi <= 0
  ) {
    throw new RangeError("Inter-label spacing and printer DPI must be valid");
  }
  const spacingRows = Math.round((spacingMm * dpi) / 25.4);
  if (spacingRows === 0 || pages.length < 2) return pages;
  return pages.map((page, index) => {
    if (index === pages.length - 1) return page;
    const data = new Uint8Array(
      page.data.length + spacingRows * page.bytesPerRow,
    );
    data.set(page.data);
    return {
      ...page,
      heightPixels: page.heightPixels + spacingRows,
      data,
    };
  });
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
  /** One fallback value for adapters whose supported printers are identical. */
  readonly offlineCapabilities?: OfflinePrinterCapabilities;
  /** Return offline values for a detected model in a multi-model adapter. */
  offlineCapabilitiesFor?(
    printer: PrinterDescriptor,
  ): OfflinePrinterCapabilities | undefined;
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
