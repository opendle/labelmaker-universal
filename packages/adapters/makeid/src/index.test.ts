import type {
  AdapterContext,
  DiscoveryOptions,
  PrinterDescriptor,
  RasterPage,
} from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
  encodeMakeIdE1Page,
  MakeIdAdapterError,
  MakeIdE1Adapter,
} from "./index.js";
import {
  RecordingMakeIdTransport,
  type MakeIdTransport,
  type MakeIdTransportDevice,
  type MakeIdTransportProvider,
} from "./transport.js";

describe("MakeIdE1Adapter", () => {
  it("discovers only names which identify an E1", async () => {
    const provider = new FakeProvider(
      [
        { id: "e1-a", name: "YichipFPGA-42A1" },
        { id: "e1-b", name: "MakeID E1" },
        { id: "l1", name: "MakeID L1" },
        { id: "speaker", name: "Kitchen speaker" },
      ],
      new RecordingMakeIdTransport(),
    );
    const adapter = new MakeIdE1Adapter(provider);

    const printers = await adapter.discover({ timeoutMs: 500 }, context);

    expect(printers.map((printer) => printer.displayName)).toEqual([
      "YichipFPGA-42A1",
      "MakeID E1",
    ]);
    expect(printers[0]?.connection).toEqual({
      model: "E1",
      transportDeviceId: "e1-a",
      advertisedName: "YichipFPGA-42A1",
    });
  });

  it("reports the E1 print head and continuous tape capabilities", async () => {
    const transport = new RecordingMakeIdTransport();
    const session = await connectSession(transport);

    const result = await session.capabilities();

    expect(result).toMatchObject({
      dpi: 203,
      rasterWidthPixels: 96,
      maxCopies: 9,
      supportsCut: false,
      supportsStatus: true,
    });
    expect(result.media.map((media) => media.widthMm)).toEqual([9, 12, 16]);
  });

  it("sends chunks, retries once, waits for completion, and reports progress", async () => {
    const transport = new RecordingMakeIdTransport([
      response(), // Initial ready query.
      response(), // First raster ACK.
      response({ resend: true }),
      response(), // Second raster retry ACK.
      response({ printing: true }),
      response(), // Completed.
    ]);
    const session = await connectSession(transport);
    const onProgress = vi.fn();

    await session.print(
      {
        id: "job-1",
        printerId: printer.id,
        pages: [page(200)],
        copies: 2,
        mediaId: "makeid-e1-12mm-continuous",
        options: { "makeid.darkness": 18 },
      },
      onProgress,
    );

    expect(transport.writes.map((write) => write[3])).toEqual([
      0x10, 0x1b, 0x1b, 0x1b, 0x10, 0x10, 0x10,
    ]);
    expect(transport.writes[2]).toEqual(transport.writes[3]);
    expect(transport.writes[1]?.[4]).toBe(0x20 | 18);
    expect(onProgress).toHaveBeenCalledWith({
      completedPages: 1,
      totalPages: 1,
      message: "Printed label 1 of 1",
    });
  });

  it("sends a best-effort reset when a transfer is cancelled", async () => {
    const controller = new AbortController();
    const transport = new CancellingTransport(controller, [response()]);
    const session = await connectSession(transport);

    await expect(
      session.print(
        {
          id: "job-cancel",
          printerId: printer.id,
          pages: [page(1)],
          copies: 1,
        },
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "makeid.cancelled" });

    expect(transport.writes.at(-1)).toEqual(
      Uint8Array.of(0x66, 0x06, 0x00, 0x10, 0x03, 0x81),
    );
  });

  it("rejects a raster which could be cropped by the adapter", () => {
    expect(() =>
      encodeMakeIdE1Page({
        widthPixels: 72,
        heightPixels: 1,
        bytesPerRow: 9,
        data: new Uint8Array(9),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MakeIdAdapterError>>({
        code: "makeid.invalid-job",
      }),
    );
  });
});

const context: AdapterContext = {
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
};

const printer: PrinterDescriptor = {
  id: "makeid:e1-test",
  adapterId: "makeid",
  displayName: "MakeID E1 test fixture",
  transport: "bluetooth-classic",
  connection: {
    model: "E1",
    transportDeviceId: "e1-test",
  },
};

async function connectSession(transport: MakeIdTransport) {
  const adapter = new MakeIdE1Adapter(new FakeProvider([], transport), {
    completionPollIntervalMs: 0,
  });
  return adapter.connect(printer, context);
}

function page(heightPixels: number): RasterPage {
  return {
    widthPixels: 96,
    heightPixels,
    bytesPerRow: 12,
    data: Uint8Array.from(
      { length: heightPixels * 12 },
      (_, index) => (index * 37) & 0xff,
    ),
  };
}

function response(
  options: { resend?: boolean; printing?: boolean } = {},
): Uint8Array {
  const bytes = new Uint8Array(36);
  bytes[0] = 0x66;
  bytes[1] = 36;
  bytes[3] = 0x10;
  bytes[4] = options.resend ? 0x40 : 0;
  bytes[35] = options.printing ? 0x80 : 0;
  return bytes;
}

class FakeProvider implements MakeIdTransportProvider {
  constructor(
    private readonly devices: readonly MakeIdTransportDevice[],
    private readonly transport: MakeIdTransport,
  ) {}

  async discover(
    _options: DiscoveryOptions,
  ): Promise<readonly MakeIdTransportDevice[]> {
    return this.devices;
  }

  async connect(): Promise<MakeIdTransport> {
    return this.transport;
  }
}

class CancellingTransport extends RecordingMakeIdTransport {
  constructor(
    private readonly controller: AbortController,
    responses: readonly Uint8Array[],
  ) {
    super(responses);
  }

  override async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    await super.write(bytes, signal);
    if (bytes[3] === 0x1b) {
      this.controller.abort();
    }
  }
}
