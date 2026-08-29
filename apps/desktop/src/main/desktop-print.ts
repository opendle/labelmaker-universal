import { randomUUID } from "node:crypto";

import type { LabelPlate } from "@labelmaker/domain";
import { addInterLabelSpacing } from "@labelmaker/printing";
import type {
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSettings,
  PrinterSession,
  RasterPage,
} from "@labelmaker/printing";

import type { ValidatedPrintRequest } from "./print-request.js";
import type { SavedPrinterRecord } from "./printer-configuration.js";

export interface PrintRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly printableWidthMm: number;
  readonly marginTopMm: number;
  readonly marginBottomMm: number;
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
  savedPrinterRecords: Readonly<Record<string, SavedPrinterRecord>> = {},
): readonly PrinterDescriptor[] {
  const descriptors = new Map<string, PrinterDescriptor>();
  for (const printerId of configuredPrinterIds) {
    const savedPrinter = savedPrinterRecords[printerId];
    if (savedPrinter) {
      // A saved MakeID profile is the result of a protocol query. Keep it in
      // preference to an unresolved discovery result. Android and Windows
      // shells must apply the same rule when they add persistence later.
      descriptors.set(printerId, savedPrinter);
      continue;
    }
    const discoveredPrinter = discovered.find(
      (printer) => printer.id === printerId,
    );
    if (discoveredPrinter) {
      descriptors.set(printerId, discoveredPrinter);
      continue;
    }

    // Version 1 saved only an E1 transport key in the printer ID. Keep this
    // fallback for migration, but do not use it for new model profiles.
    const savedTransport = makeIdSavedTransport(printerId);
    if (!savedTransport) continue;
    descriptors.set(printerId, {
      id: printerId,
      adapterId: "makeid",
      displayName: "MakeID E1",
      transport: savedTransport.transport,
      connection: {
        model: "E1",
        transportDeviceId: savedTransport.transportDeviceId,
      },
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
  const printableWidthMm =
    settings.printHeadSizeMm ?? capabilities.printableWidthMm;
  const marginTopMm =
    settings.marginTopMm ?? capabilities.printHeadMarginTopMm ?? 0;
  const marginBottomMm =
    settings.marginBottomMm ?? capabilities.printHeadMarginBottomMm ?? 0;
  const pages: RasterPage[] = [];
  for (const plateId of request.plateIds) {
    const plate = request.document.plates.find((item) => item.id === plateId);
    if (!plate) throw new Error(`Plate was not found: ${plateId}`);
    pages.push(
      await renderPlate(plate, {
        dpi: capabilities.dpi,
        rasterWidthPixels: capabilities.rasterWidthPixels,
        printableWidthMm,
        marginTopMm,
        marginBottomMm,
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
    pages: addInterLabelSpacing(
      pages,
      settings.interLabelSpacingMm ?? 1,
      capabilities.dpi,
    ),
    copies: 1,
    ...(mediaId === undefined ? {} : { mediaId }),
    ...(settings.darkness === undefined ? {} : { darkness: settings.darkness }),
  });
  const count = request.plateIds.length;
  return {
    message: `${count} ${count === 1 ? "label" : "labels"} sent to ${settings.displayName ?? descriptor.displayName}`,
  };
}

function makeIdSavedTransport(printerId: string):
  | {
      readonly transportDeviceId: string;
      readonly transport: "bluetooth-classic" | "bluetooth-low-energy";
    }
  | undefined {
  const prefix = "makeid:";
  if (!printerId.startsWith(prefix)) return undefined;
  const transportDeviceId = printerId.slice(prefix.length);
  if (/^macos-bt-[0-9a-f]{24}$/.test(transportDeviceId)) {
    return { transportDeviceId, transport: "bluetooth-classic" };
  }
  if (
    /^macos-ble-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(
      transportDeviceId,
    )
  ) {
    return { transportDeviceId, transport: "bluetooth-low-energy" };
  }
  return undefined;
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
