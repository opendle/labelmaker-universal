import type {
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
  PrinterStatus,
} from "@labelmaker/printing";

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
  readonly batteryPercent?: number;
}

interface PrinterSummaryOptions {
  readonly attempts?: number;
  readonly retryDelayMs?: number;
  readonly probe?: boolean;
  readonly onFailure?: (error: unknown) => void;
}

function availableSummary(
  printer: PrinterDescriptor,
  model: string,
): DesktopPrinterSummary {
  return {
    id: printer.id,
    adapterId: printer.adapterId,
    name: printer.displayName,
    model,
    transport: printer.transport,
    state: "connecting",
    statusMessage: "Available",
  };
}

/** Read a printer summary without treating a failed probe as disconnection. */
export async function summarizePrinter(
  printer: PrinterDescriptor,
  model: string,
  getSession: (printer: PrinterDescriptor) => Promise<PrinterSession>,
  discardSession: (printerId: string) => Promise<void>,
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
  if (options.probe === false) return availableSummary(printer, model);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const session = await getSession(printer);
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
        dpi: capabilities.dpi,
        rasterWidthPixels: capabilities.rasterWidthPixels,
        ...(status.batteryPercent === undefined
          ? {}
          : { batteryPercent: status.batteryPercent }),
      };
    } catch (error) {
      lastError = error;
      await discardSession(printer.id);
      if (attempt + 1 < attempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  options.onFailure?.(lastError);
  return availableSummary(printer, model);
}
