import type { PrinterDescriptor, PrinterSession } from "@labelmaker/printing";

interface PrinterDescriptorCache {
  get(printerId: string): PrinterDescriptor | undefined;
}

/** Resolve the selected discovery result and open Bluetooth pairing once. */
export async function openPrinterForAddition(
  printerId: string,
  cache: PrinterDescriptorCache,
  discover: () => Promise<readonly PrinterDescriptor[]>,
  openSession: (printer: PrinterDescriptor) => Promise<PrinterSession>,
): Promise<{
  readonly descriptor: PrinterDescriptor;
  readonly session: PrinterSession;
}> {
  const descriptor =
    cache.get(printerId) ??
    (await discover()).find((printer) => printer.id === printerId);
  if (!descriptor) throw new Error("Printer was not found");
  return { descriptor, session: await openSession(descriptor) };
}
