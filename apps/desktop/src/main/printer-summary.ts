import type {
  NumericSettingCapability,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSettings,
  PrinterSession,
  PrinterStatus,
} from "@labelmaker/printing";

type OfflineCapabilities = NonNullable<
  import("@labelmaker/printing").PrinterAdapter["offlineCapabilities"]
>;

export interface DesktopNumericSetting extends NumericSettingCapability {
  readonly value: number;
}

export interface DesktopPrinterSummary {
  readonly id: string;
  readonly adapterId: string;
  readonly name: string;
  readonly deviceName: string;
  readonly model: string;
  readonly transport: PrinterDescriptor["transport"];
  readonly state: PrinterStatus["state"];
  readonly statusMessage: string;
  readonly dpi?: number;
  readonly rasterWidthPixels?: number;
  readonly printableWidthMm?: number;
  readonly marginTopMm?: number;
  readonly marginBottomMm?: number;
  readonly interLabelSpacingMm?: number;
  readonly darkness?: DesktopNumericSetting;
  readonly batteryPercent?: number;
}

interface PrinterSummaryOptions {
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly probe?: boolean;
  readonly onFailure?: (error: unknown) => void;
  readonly offlineCapabilities?: OfflineCapabilities;
  readonly settings?: PrinterSettings;
  /** Keep a transport alive when a background status check times out. */
  readonly preserveSessionOnFailure?: boolean;
  readonly unprobedState?: PrinterStatus["state"];
  readonly unprobedStatusMessage?: string;
}

/** Keep the exact descriptors from the last explicit nearby-printer search. */
export class PrinterDiscoveryCache {
  readonly #printers = new Map<string, PrinterDescriptor>();

  replace(printers: readonly PrinterDescriptor[]): void {
    this.#printers.clear();
    for (const printer of printers) this.#printers.set(printer.id, printer);
  }

  get(printerId: string): PrinterDescriptor | undefined {
    return this.#printers.get(printerId);
  }

  delete(printerId: string): void {
    this.#printers.delete(printerId);
  }
}

export function shouldProbePrinterStatus(
  adapterId: string,
  hasSession: boolean,
  hasActiveJob: boolean,
): boolean {
  if (hasActiveJob) return false;
  return adapterId !== "makeid" || hasSession;
}

function capabilitySummary(
  capabilities: OfflineCapabilities | PrinterCapabilities | undefined,
  settings: PrinterSettings | undefined,
) {
  if (!capabilities) return {};
  return {
    dpi: capabilities.dpi,
    rasterWidthPixels: capabilities.rasterWidthPixels,
    printableWidthMm:
      settings?.printHeadSizeMm ?? capabilities.printableWidthMm,
    marginTopMm:
      settings?.marginTopMm ?? capabilities.printHeadMarginTopMm ?? 0,
    marginBottomMm:
      settings?.marginBottomMm ?? capabilities.printHeadMarginBottomMm ?? 0,
    interLabelSpacingMm: settings?.interLabelSpacingMm ?? 1,
    ...(capabilities.darkness === undefined
      ? {}
      : {
          darkness: {
            ...capabilities.darkness,
            value: settings?.darkness ?? capabilities.darkness.defaultValue,
          },
        }),
  };
}

function offlineSummary(
  printer: PrinterDescriptor,
  model: string,
  state: PrinterStatus["state"],
  statusMessage: string,
  capabilities?: OfflineCapabilities,
  settings?: PrinterSettings,
): DesktopPrinterSummary {
  return {
    id: printer.id,
    adapterId: printer.adapterId,
    name: settings?.displayName ?? printer.displayName,
    deviceName: printer.displayName,
    model,
    transport: printer.transport,
    state,
    statusMessage,
    ...capabilitySummary(capabilities, settings),
  };
}

/** Read a printer summary without treating a failed probe as disconnection. */
export async function summarizePrinter(
  printer: PrinterDescriptor,
  model: string,
  getSession: (printer: PrinterDescriptor) => Promise<PrinterSession>,
  discardSession: (
    printerId: string,
    expectedSession?: PrinterSession,
  ) => Promise<void>,
  options: PrinterSummaryOptions = {},
): Promise<DesktopPrinterSummary> {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 500;
  if (
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    !Number.isInteger(retryDelayMs) ||
    retryDelayMs < 0
  ) {
    throw new RangeError("Printer summary retry options are invalid");
  }
  if (options.probe === false)
    return offlineSummary(
      printer,
      model,
      options.unprobedState ?? "disconnected",
      options.unprobedStatusMessage ?? "Connects on print",
      options.offlineCapabilities,
      options.settings,
    );

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let session: PrinterSession | undefined;
    try {
      session = await getSession(printer);
      const [status, capabilities]: [PrinterStatus, PrinterCapabilities] =
        await Promise.all([session.status(), session.capabilities()]);
      return {
        id: printer.id,
        adapterId: printer.adapterId,
        name: options.settings?.displayName ?? printer.displayName,
        deviceName: printer.displayName,
        model,
        transport: printer.transport,
        state: status.state,
        statusMessage: status.message ?? status.state,
        ...capabilitySummary(capabilities, options.settings),
        ...(status.batteryPercent === undefined
          ? {}
          : { batteryPercent: status.batteryPercent }),
      };
    } catch (error) {
      lastError = error;
      if (!options.preserveSessionOnFailure) {
        await discardSession(printer.id, session);
      }
      if (attempt + 1 < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  options.onFailure?.(lastError);
  return offlineSummary(
    printer,
    model,
    "disconnected",
    "Not reachable",
    options.offlineCapabilities,
    options.settings,
  );
}
