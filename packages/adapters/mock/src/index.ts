import type {
  AdapterContext,
  DiscoveryOptions,
  PrintJob,
  PrintProgress,
  PrinterAdapter,
  PrinterCapabilities,
  PrinterDescriptor,
  PrinterSession,
  PrinterStatus,
} from "@labelmaker/printing";

const printers: readonly PrinterDescriptor[] = [
  {
    id: "mock-studio",
    adapterId: "mock",
    displayName: "Studio Labeler",
    transport: "mock",
    connection: { fixture: "ready" },
  },
  {
    id: "mock-workshop",
    adapterId: "mock",
    displayName: "Workshop Printer",
    transport: "mock",
    connection: { fixture: "offline" },
  },
];

const capabilities: PrinterCapabilities = {
  dpi: 203,
  rasterWidthPixels: 96,
  colorModes: ["monochrome"],
  media: [
    {
      id: "12mm-continuous",
      displayName: "12 mm continuous",
      widthMm: 12,
      continuous: true,
    },
    {
      id: "16mm-continuous",
      displayName: "16 mm continuous",
      widthMm: 16,
      continuous: true,
    },
  ],
  maxCopies: 99,
  supportsCut: false,
  supportsStatus: true,
};

class MockPrinterSession implements PrinterSession {
  constructor(readonly printer: PrinterDescriptor) {}

  async capabilities(): Promise<PrinterCapabilities> {
    return capabilities;
  }

  async status(): Promise<PrinterStatus> {
    return this.printer.id === "mock-workshop"
      ? { state: "disconnected", message: "Printer is offline" }
      : { state: "ready", message: "Ready", batteryPercent: 82 };
  }

  async print(
    job: PrintJob,
    onProgress?: (progress: PrintProgress) => void,
  ): Promise<void> {
    for (let index = 0; index < job.pages.length; index += 1) {
      onProgress?.({ completedPages: index + 1, totalPages: job.pages.length });
    }
  }

  async close(): Promise<void> {}
}

export class MockPrinterAdapter implements PrinterAdapter {
  readonly manifest = {
    id: "mock",
    displayName: "Mock printers",
    manufacturers: ["Labelmaker"],
    transports: ["mock"],
  } as const;

  async discover(
    options: DiscoveryOptions,
    context: AdapterContext,
  ): Promise<readonly PrinterDescriptor[]> {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }
    context.log.debug("Mock printer discovery completed", {
      count: printers.length,
    });
    return printers;
  }

  async connect(
    printer: PrinterDescriptor,
    context: AdapterContext,
    signal?: AbortSignal,
  ): Promise<PrinterSession> {
    if (signal?.aborted) {
      throw signal.reason;
    }
    if (printer.adapterId !== this.manifest.id) {
      throw new Error(`Mock adapter cannot connect printer: ${printer.id}`);
    }
    context.log.info("Mock printer connected", { printerId: printer.id });
    return new MockPrinterSession(printer);
  }
}

export const mockPrinterFixtures = printers;
