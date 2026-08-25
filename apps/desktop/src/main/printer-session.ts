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
): Promise<PrinterSession> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const session = await getSession(printer);
      const status = await session.status();
      if (status.state === "ready") return session;
      throw new Error(status.message ?? `Printer is ${status.state}`);
    } catch (error) {
      lastError = error;
      await discardSession(printer.id);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("The printer could not be connected");
}
