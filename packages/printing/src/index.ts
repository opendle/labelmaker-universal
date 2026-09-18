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
  readonly choices?: readonly {
    readonly value: number;
    readonly label: string;
  }[];
}

/** Cross-feed position of media relative to the print head. */
export type RasterAlignment = "start" | "center" | "end";

/** Return the overlap of paper and head in coordinates across the paper. */
export function printerVerticalGeometry(
  paperHeightMm: number,
  printHeadSizeMm: number,
  rasterAlignment: RasterAlignment = "center",
) {
  if (!Number.isFinite(paperHeightMm) || paperHeightMm <= 0) {
    throw new RangeError("Paper height must be greater than zero");
  }
  if (!Number.isFinite(printHeadSizeMm) || printHeadSizeMm <= 0) {
    throw new RangeError("Printhead size must be greater than zero");
  }
  if (!["start", "center", "end"].includes(rasterAlignment)) {
    throw new RangeError("Printer raster alignment is invalid");
  }
  const differenceMm = paperHeightMm - printHeadSizeMm;
  const headTopMm =
    rasterAlignment === "start"
      ? 0
      : rasterAlignment === "end"
        ? differenceMm
        : differenceMm / 2;
  const topMm = Math.max(0, headTopMm);
  const bottomMm = Math.max(0, differenceMm - headTopMm);
  return {
    headTopMm,
    topMm,
    bottomMm,
    heightMm: Math.min(paperHeightMm, printHeadSizeMm),
  };
}

export interface PrinterCapabilities {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  /** Physical head dimension across the paper, in millimeters. */
  readonly printableWidthMm: number;
  /** Position of the media across the physical print head. */
  readonly rasterAlignment: RasterAlignment;
  readonly darkness?: NumericSettingCapability;
  /** Default blank feed after the last label, in millimeters. */
  readonly feedAfterPrintMm?: number;
  readonly minimumLabelWidthMm?: number;
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
      "darkness" | "feedAfterPrintMm" | "minimumLabelWidthMm"
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
  /** Saved override of printableWidthMm, across the paper in millimeters. */
  readonly printHeadSizeMm?: number;
  readonly interLabelSpacingMm?: number;
  readonly feedAfterPrintMm?: number;
  readonly minimumLabelWidthMm?: number;
}

const PRINTER_SETTING_KEYS = new Set([
  "displayName",
  "darkness",
  "printHeadSizeMm",
  "interLabelSpacingMm",
  "feedAfterPrintMm",
  "minimumLabelWidthMm",
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
    (!("interLabelSpacingMm" in value) ||
      isTenthMillimeter(value.interLabelSpacingMm, 0)) &&
    (!("feedAfterPrintMm" in value) ||
      isTenthMillimeter(value.feedAfterPrintMm, 0)) &&
    (!("minimumLabelWidthMm" in value) ||
      isTenthMillimeter(value.minimumLabelWidthMm, 0))
  );
}

/** Validate stored settings, then remove only the old vertical margins. */
export function readLegacyPrinterSettings(
  value: unknown,
): PrinterSettings | undefined {
  if (!isRecord(value)) return undefined;
  const { marginTopMm, marginBottomMm, ...settings } = value;
  if (
    ("marginTopMm" in value && !isTenthMillimeter(marginTopMm, 0)) ||
    ("marginBottomMm" in value && !isTenthMillimeter(marginBottomMm, 0)) ||
    !isPrinterSettings(settings)
  )
    return undefined;
  return settings;
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

/** Add white rows between pages and after the last page, without changing width. */
export function addInterLabelSpacing(
  pages: readonly RasterPage[],
  spacingMm: number,
  dpi: number,
  feedAfterPrintMm = 0,
  minimumLabelWidthMm = 0,
): readonly RasterPage[] {
  if (
    !isTenthMillimeter(feedAfterPrintMm, 0) ||
    !isTenthMillimeter(minimumLabelWidthMm, 0) ||
    !Number.isFinite(spacingMm) ||
    spacingMm < 0 ||
    !Number.isFinite(dpi) ||
    dpi <= 0
  ) {
    throw new RangeError(
      "Print spacing, final feed, and printer DPI must be valid",
    );
  }
  const spacingRows = Math.round((spacingMm * dpi) / 25.4);
  const finalRows = Math.round((feedAfterPrintMm * dpi) / 25.4);
  const minimumRows = Math.ceil((minimumLabelWidthMm * dpi) / 25.4);
  if (
    minimumRows === 0 &&
    finalRows === 0 &&
    (spacingRows === 0 || pages.length < 2)
  )
    return pages;
  return pages.map((page, index) => {
    const extraRows =
      Math.max(0, minimumRows - page.heightPixels) +
      (index === pages.length - 1 ? finalRows : spacingRows);
    if (extraRows === 0) return page;
    const data = new Uint8Array(
      page.data.length + extraRows * page.bytesPerRow,
    );
    data.set(page.data);
    return {
      ...page,
      heightPixels: page.heightPixels + extraRows,
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
