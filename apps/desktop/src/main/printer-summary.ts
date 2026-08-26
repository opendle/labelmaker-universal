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
  readonly model: string;
  readonly transport: PrinterDescriptor["transport"];
  readonly state: PrinterStatus["state"];
  readonly statusMessage: string;
  readonly dpi?: number;
  readonly rasterWidthPixels?: number;
  readonly printableWidthMm?: number;
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
    printableWidthMm: capabilities.printableWidthMm,
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
  statusMessage: string,
  capabilities?: OfflineCapabilities,
  settings?: PrinterSettings,
): DesktopPrinterSummary {
  return {
    id: printer.id,
    adapterId: printer.adapterId,
    name: printer.displayName,
    model,
    transport: printer.transport,
    state: "disconnected",
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
      "Saved; not checked",
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
        name: printer.displayName,
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
      await discardSession(printer.id, session);
      if (attempt + 1 < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  options.onFailure?.(lastError);
  return offlineSummary(
    printer,
    model,
    "Not reachable",
    options.offlineCapabilities,
    options.settings,
  );
}
