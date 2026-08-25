import type { LabelPlate } from "@labelmaker/domain";
import type {
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
  RasterPage,
} from "@labelmaker/printing";

import type { ValidatedPrintRequest } from "./print-request.js";

export interface PrintRasterTarget {
  readonly dpi: number;
  readonly rasterWidthPixels: number;
  readonly verticalMarginMm?: number;
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

export async function printToSession(
  request: ValidatedPrintRequest,
  descriptor: PrinterDescriptor,
  session: PrinterSession,
  renderPlate: DesktopPlateRenderer,
  createJobId: () => string = () => `print-job-${Date.now()}`,
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
        ...(capabilities.verticalMarginMm === undefined
          ? {}
          : { verticalMarginMm: capabilities.verticalMarginMm }),
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
  });
  const count = request.plateIds.length;
  return {
    message: `${count} ${count === 1 ? "label" : "labels"} sent to ${descriptor.displayName}`,
  };
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
