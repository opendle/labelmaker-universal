import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";

/**
 * Get a session which answered a fresh ready-status query.
 *
 * Bluetooth connections can disappear without notifying the renderer. The
 * caller owns the cache and supplies a discard function so a failed status
 * probe always causes the next attempt to create a new session.
 */
export async function getReadyPrinterSession(
  printer: PrinterDescriptor,
  getSession: (printer: PrinterDescriptor) => Promise<PrinterSession>,
  discardSession: (printerId: string) => Promise<void>,
  maxAttempts = 2,
  statusAttempts = 3,
  statusRetryDelayMs = 250,
): Promise<PrinterSession> {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    !Number.isInteger(statusAttempts) ||
    statusAttempts < 1 ||
    !Number.isInteger(statusRetryDelayMs) ||
    statusRetryDelayMs < 0
  ) {
    throw new RangeError("Printer session retry options are invalid");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const session = await getSession(printer);
      for (let probe = 0; probe < statusAttempts; probe += 1) {
        try {
          const status = await session.status();
          if (status.state === "ready") return session;
          throw new Error(status.message ?? `Printer is ${status.state}`);
        } catch (error) {
          lastError = error;
          if (probe + 1 >= statusAttempts) throw error;
          if (statusRetryDelayMs > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, statusRetryDelayMs),
            );
          }
        }
      }
    } catch (error) {
      lastError = error;
      await discardSession(printer.id);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The printer could not be connected");
}
