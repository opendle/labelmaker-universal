import { randomUUID } from "node:crypto";

import type { LabelPlate } from "@labelmaker/domain";
import type {
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSettings,
  PrinterSession,
  RasterPage,
} from "@labelmaker/printing";

import type { ValidatedPrintRequest } from "./print-request.js";

export interface PrintRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly printableWidthMm: number;
}

export type DesktopPlateRenderer = (
  plate: LabelPlate,
  target: PrintRasterTarget,
) => Promise<RasterPage>;

export function findConfiguredPrintTarget(
  descriptors: readonly PrinterDescriptor[],
  configuredPrinterIds: ReadonlySet<string>,
  printerId: string,
): PrinterDescriptor {
  const descriptor = descriptors.find((item) => item.id === printerId);
  if (!descriptor || !configuredPrinterIds.has(descriptor.id)) {
    throw new Error("Configured printer was not found");
  }
  return descriptor;
}

/**
 * Rebuild the minimum stable MakeID descriptor from its persisted opaque ID.
 * This lets a configured paired printer connect even when a routine discovery
 * call is slow or returns no transient descriptor.
 */
export function configuredPrinterDescriptors(
  discovered: readonly PrinterDescriptor[],
  configuredPrinterIds: ReadonlySet<string>,
): readonly PrinterDescriptor[] {
  const descriptors = new Map(
    discovered
      .filter((printer) => configuredPrinterIds.has(printer.id))
      .map((printer) => [printer.id, printer] as const),
  );
  for (const printerId of configuredPrinterIds) {
    if (descriptors.has(printerId)) continue;
    const transportDeviceId = makeIdTransportDeviceId(printerId);
    if (!transportDeviceId) continue;
    descriptors.set(printerId, {
      id: printerId,
      adapterId: "makeid",
      displayName: "MakeID E1",
      transport: "bluetooth-classic",
      connection: { model: "E1", transportDeviceId },
    });
  }
  return [...descriptors.values()];
}

export async function printToSession(
  request: ValidatedPrintRequest,
  descriptor: PrinterDescriptor,
  session: PrinterSession,
  renderPlate: DesktopPlateRenderer,
  createJobId: () => string = () => `print-job-${randomUUID()}`,
  settings: PrinterSettings = {},
): Promise<{ readonly message: string }> {
  if (
    request.printerId !== descriptor.id ||
    session.printer.id !== descriptor.id
  ) {
    throw new Error("The printer session does not match the print request");
  }
  const capabilities = await session.capabilities();
  const pages: RasterPage[] = [];
  for (const plateId of request.plateIds) {
    const plate = request.document.plates.find((item) => item.id === plateId);
    if (!plate) throw new Error(`Plate was not found: ${plateId}`);
    pages.push(
      await renderPlate(plate, {
        dpi: capabilities.dpi,
        rasterWidthPixels: capabilities.rasterWidthPixels,
        printableWidthMm: capabilities.printableWidthMm,
      }),
    );
  }
  const mediaId = nearestMediaId(
    request.document.plates.find((plate) => plate.id === request.plateIds[0])
      ?.size.heightMm,
    capabilities.media,
  );
  await session.print({
    id: createJobId(),
    printerId: descriptor.id,
    pages,
    copies: 1,
    ...(mediaId === undefined ? {} : { mediaId }),
    ...(settings.darkness === undefined ? {} : { darkness: settings.darkness }),
  });
  const count = request.plateIds.length;
  return {
    message: `${count} ${count === 1 ? "label" : "labels"} sent to ${descriptor.displayName}`,
  };
}

function makeIdTransportDeviceId(printerId: string): string | undefined {
  const prefix = "makeid:";
  if (!printerId.startsWith(prefix)) return undefined;
  const transportDeviceId = printerId.slice(prefix.length);
  return /^macos-bt-[0-9a-f]{24}$/.test(transportDeviceId)
    ? transportDeviceId
    : undefined;
}

function nearestMediaId(
  heightMm: number | undefined,
  media: PrinterCapabilities["media"],
): string | undefined {
  if (heightMm === undefined || media.length === 0) return undefined;
  return [...media].sort(
    (left, right) =>
      Math.abs(left.widthMm - heightMm) - Math.abs(right.widthMm - heightMm),
  )[0]?.id;
}
