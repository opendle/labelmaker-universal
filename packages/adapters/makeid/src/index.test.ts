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
      printableWidthMm: 12,
      darkness: { minimum: 0, maximum: 31, step: 1, defaultValue: 20 },
      maxCopies: 9,
      supportsCut: false,
      supportsStatus: true,
    });
    expect(result.media.map((media) => media.widthMm)).toEqual([9, 12, 16]);
  });

  it("reports a useful recovery action when Bluetooth cannot connect", async () => {
    const adapter = new MakeIdE1Adapter({
      discover: async () => [],
      connect: async () => {
        throw new Error("RFCOMM failed");
      },
    });

    await expect(adapter.connect(printer, context)).rejects.toMatchObject({
      code: "makeid.transport",
      retryable: true,
      message:
        "Could not connect to the MakeID E1. Turn it off and on. If macOS still shows it as connected, forget it in Bluetooth Settings, then add it again in Labelmaker.",
    });
  });

  it("sends chunks, retries once, waits for completion, and reports progress", async () => {
    const transport = new RecordingMakeIdTransport([
      response(), // Initial ready query.
      response(), // First raster ACK.
      response({ resend: true }),
      response(), // Second raster retry ACK.
      response({ printing: true }),
      response(), // Completed.
      response({ exited: true }), // Final 0x03 control reply.
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
        darkness: 18,
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

  it("consumes the final control reply before two consecutive prints", async () => {
    const transport = new RecordingMakeIdTransport([
      response(),
      response(),
      response(),
      response({ exited: true }),
      response(),
      response(),
      response(),
      response({ exited: true }),
    ]);
    const session = await connectSession(transport);

    await session.print(printJob("job-first"));
    await session.print(printJob("job-second"));

    expect(transport.writes.map((write) => [write[3], write[4]])).toEqual([
      [0x10, 0x00],
      [0x1b, 0x34],
      [0x10, 0x00],
      [0x10, 0x03],
      [0x10, 0x00],
      [0x1b, 0x34],
      [0x10, 0x00],
      [0x10, 0x03],
    ]);
  });

  it.each([
    { name: "missing", finalResponse: undefined },
    {
      name: "invalid",
      finalResponse: Uint8Array.of(0x41, 0x06, 0, 0x10, 0, 0),
    },
  ])(
    "keeps a confirmed print successful when the final reply is $name",
    async ({ finalResponse }) => {
      vi.mocked(context.log.warn).mockClear();
      const responses = [response(), response(), response()];
      if (finalResponse) responses.push(finalResponse);
      const transport = new RecordingMakeIdTransport(responses);
      const session = await connectSession(transport);

      await expect(
        session.print(printJob("job-final-reply")),
      ).resolves.toBeUndefined();

      expect(transport.open).toBe(false);
      await expect(session.status()).rejects.toMatchObject({
        code: "makeid.closed",
      });
      expect(context.log.warn).toHaveBeenCalledWith(
        "The MakeID E1 final reply was not usable. The session was closed.",
        expect.objectContaining({ reason: expect.any(String) }),
      );
    },
  );

  it("serializes status and close operations behind a print", async () => {
    const transport = new ControlledTransport([response()]);
    const session = await connectSession(transport);
    const printPromise = session.print(printJob("job-serialized"));
    await transport.rasterWritten;

    const statusPromise = session.status();
    const closePromise = session.close();
    await Promise.resolve();

    expect(transport.writes.map((write) => write[3])).toEqual([0x10, 0x1b]);
    expect(transport.open).toBe(true);

    transport.queueResponse(response()); // Raster ACK.
    transport.queueResponse(response()); // Print completion.
    transport.queueResponse(response({ exited: true })); // Final 0x03 reply.
    transport.queueResponse(response()); // Serialized status reply.

    await expect(printPromise).resolves.toBeUndefined();
    await expect(statusPromise).resolves.toEqual({
      state: "ready",
      message: "Ready",
    });
    await expect(closePromise).resolves.toBeUndefined();
    expect(transport.open).toBe(false);
    expect(transport.writes.map((write) => [write[3], write[4]])).toEqual([
      [0x10, 0x00],
      [0x1b, 0x34],
      [0x10, 0x00],
      [0x10, 0x03],
      [0x10, 0x00],
    ]);
  });

  it("does not let a progress callback stop final protocol cleanup", async () => {
    const transport = new RecordingMakeIdTransport([
      response(),
      response(),
      response(),
      response({ exited: true }),
    ]);
    const session = await connectSession(transport);

    await expect(
      session.print(printJob("job-progress"), () => {
        throw new Error("Test callback failure");
      }),
    ).resolves.toBeUndefined();

    expect(transport.writes.at(-1)?.[4]).toBe(0x03);
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
    expect(transport.open).toBe(false);
    await expect(session.status()).rejects.toMatchObject({
      code: "makeid.closed",
    });
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

function printJob(id: string) {
  return {
    id,
    printerId: printer.id,
    pages: [page(1)],
    copies: 1,
  };
}

function response(
  options: { resend?: boolean; printing?: boolean; exited?: boolean } = {},
): Uint8Array {
  const bytes = new Uint8Array(36);
  bytes[0] = 0x66;
  bytes[1] = 36;
  bytes[3] = 0x10;
  bytes[4] = options.resend ? 0x40 : 0;
  bytes[35] = options.printing ? 0x80 : options.exited ? 0x60 : 0;
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

class ControlledTransport implements MakeIdTransport {
  readonly writes: Uint8Array[] = [];
  readonly rasterWritten: Promise<void>;
  #resolveRasterWritten: () => void = () => undefined;
  #open = true;
  readonly #responses: Uint8Array[];
  readonly #readWaiters: Array<{
    resolve: (response: Uint8Array) => void;
    reject: (error: unknown) => void;
  }> = [];

  constructor(responses: readonly Uint8Array[]) {
    this.#responses = responses.map((responseBytes) => responseBytes.slice());
    this.rasterWritten = new Promise((resolve) => {
      this.#resolveRasterWritten = resolve;
    });
  }

  get open(): boolean {
    return this.#open;
  }

  async write(bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
    if (!this.#open) throw new Error("The test transport is closed");
    if (signal?.aborted) throw signal.reason;
    this.writes.push(bytes.slice());
    if (bytes[3] === 0x1b) this.#resolveRasterWritten();
  }

  read(): Promise<Uint8Array> {
    const responseBytes = this.#responses.shift();
    if (responseBytes) return Promise.resolve(responseBytes.slice());
    return new Promise((resolve, reject) => {
      this.#readWaiters.push({ resolve, reject });
    });
  }

  queueResponse(responseBytes: Uint8Array): void {
    const waiter = this.#readWaiters.shift();
    if (waiter) waiter.resolve(responseBytes.slice());
    else this.#responses.push(responseBytes.slice());
  }

  async close(): Promise<void> {
    this.#open = false;
    for (const waiter of this.#readWaiters.splice(0)) {
      waiter.reject(new Error("The test transport is closed"));
    }
  }
}
