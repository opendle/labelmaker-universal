import type {
  AdapterContext,
  DiscoveryOptions,
  PrinterDescriptor,
  RasterPage,
} from "@labelmaker/printing";
import { describe, expect, it, vi } from "vitest";

import {
  encodeMakeId66Page,
  encodeMakeIdE1Page,
  isMakeIdE1Name,
  MakeIdAdapter,
  MakeIdAdapterError,
  MakeIdE1Adapter,
} from "./index.js";
import { defaultProfileForId } from "./models.js";
import {
  RecordingMakeIdTransport,
  type MakeIdTransport,
  type MakeIdTransportDevice,
  type MakeIdTransportProvider,
} from "./transport.js";

describe("MakeIdAdapter", () => {
  it("discovers supported E1, L1, and P31-family names", async () => {
    const provider = new FakeProvider(
      [
        {
          id: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
          name: "E124H00894",
        },
        {
          id: "ipad-ble-fedcba98-7654-3210-fedc-ba9876543210",
          name: "MakeID E1-iPad",
        },
        { id: "e1-b", name: "MakeID E1" },
        { id: "e1-c", name: "YichipFPGA-42A1" },
        { id: "l1", name: "MakeID L1" },
        { id: "p31s", name: "P31S-Office" },
        { id: "q31", name: "MakeID Q31" },
        { id: "speaker", name: "Kitchen speaker" },
      ],
      new RecordingMakeIdTransport(),
    );
    const adapter = new MakeIdE1Adapter(provider);

    const printers = await adapter.discover({ timeoutMs: 500 }, context);

    expect(printers.map((printer) => printer.displayName)).toEqual([
      "E124H00894",
      "MakeID E1-iPad",
      "MakeID E1",
      "YichipFPGA-42A1",
      "MakeID L1",
      "P31S-Office",
      "MakeID Q31",
    ]);
    expect(printers[0]?.connection).toEqual({
      profileId: "e1-abf0-203",
      transportDeviceId: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
      advertisedName: "E124H00894",
    });
    expect(printers[4]?.connection["profileId"]).toBe("unresolved-l1");
    expect(printers[5]?.connection["profileId"]).toBe("unresolved-p31");
    expect(printers[0]?.transport).toBe("bluetooth-low-energy");
    expect(printers[1]?.transport).toBe("bluetooth-low-energy");
    expect(adapter.manifest.transports).toEqual([
      "bluetooth-low-energy",
      "bluetooth-classic",
    ]);
  });

  it("accepts the E1 serial advertisement without claiming similar names", () => {
    expect(isMakeIdE1Name("E124H00894")).toBe(true);
    expect(isMakeIdE1Name("e124h00894")).toBe(true);
    expect(isMakeIdE1Name("E124H0089")).toBe(false);
    expect(isMakeIdE1Name("E124HH0894")).toBe(false);
    expect(isMakeIdE1Name("E1 Printer")).toBe(false);
  });

  it("reports the E1 print head and continuous tape capabilities", async () => {
    const transport = recording();
    const session = await connectSession(transport);

    const result = await session.capabilities();

    expect(result).toMatchObject({
      dpi: 203,
      rasterWidthPixels: 96,
      printableWidthMm: 12,
      rasterAlignment: "start",
      printHeadMarginTopMm: 2,
      printHeadMarginBottomMm: 2,
      darkness: { minimum: 0, maximum: 31, step: 1, defaultValue: 20 },
      maxCopies: 9,
      supportsCut: false,
      supportsStatus: true,
    });
    expect(result.media.map((media) => media.widthMm)).toEqual([9, 12, 16]);
  });

  it("reports offline darkness only after a profile is known", () => {
    const adapter = new MakeIdAdapter(new FakeProvider([], recording()));

    expect(adapter.offlineCapabilitiesFor(printer)).toMatchObject({
      dpi: 203,
      darkness: { minimum: 0, maximum: 31, defaultValue: 20 },
    });
    expect(
      adapter.offlineCapabilitiesFor(
        makePrinter("l1", "unresolved-l1", "MakeID L1"),
      ),
    ).toBeUndefined();
    expect(
      adapter.offlineCapabilitiesFor(
        makePrinter("l1", "l1-abf0-300", "MakeID L1"),
      ),
    ).toMatchObject({ dpi: 300, darkness: expect.any(Object) });
  });

  it("connects a discovered BLE descriptor with its saved peripheral ID", async () => {
    const transport = recording();
    const provider = new FakeProvider([], transport);
    provider.connect = vi.fn(async () => transport);
    const adapter = new MakeIdE1Adapter(provider);
    const blePrinter: PrinterDescriptor = {
      ...printer,
      id: "makeid:macos-ble-01234567-89ab-cdef-0123-456789abcdef",
      transport: "bluetooth-low-energy",
      connection: {
        model: "E1",
        transportDeviceId: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
      },
    };

    await expect(adapter.connect(blePrinter, context)).resolves.toMatchObject({
      printer: expect.objectContaining({
        id: blePrinter.id,
        model: "MakeID E1",
        connection: expect.objectContaining({ profileId: "e1-abf0-203" }),
      }),
    });
    expect(provider.connect).toHaveBeenCalledWith(
      "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
      { protocolFamily: "abf0-66" },
      undefined,
    );
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
        "Could not identify or connect to the MakeID printer. Turn it off and on, keep it nearby, and try again. If it still fails, remove the saved printer and add it again.",
    });
  });

  it("sends chunks, retries once, waits for completion, and reports progress", async () => {
    const transport = recording([
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
      0x10, 0x10, 0x1b, 0x1b, 0x1b, 0x10, 0x10, 0x10,
    ]);
    expect(transport.writes[3]).toEqual(transport.writes[4]);
    expect(transport.writes[2]?.[4]).toBe(0x20 | 18);
    expect(onProgress).toHaveBeenCalledWith({
      completedPages: 1,
      totalPages: 1,
      message: "Printed label 1 of 1",
    });
  });

  it("consumes the final control reply before two consecutive prints", async () => {
    const transport = recording([
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
      const transport = recording(responses);
      const session = await connectSession(transport);

      await expect(
        session.print(printJob("job-final-reply")),
      ).resolves.toBeUndefined();

      expect(transport.open).toBe(false);
      await expect(session.status()).rejects.toMatchObject({
        code: "makeid.closed",
      });
      expect(context.log.warn).toHaveBeenCalledWith(
        "The MakeID final reply was not usable. The session was closed.",
        expect.objectContaining({ reason: expect.any(String) }),
      );
    },
  );

  it("serializes status and close operations behind a print", async () => {
    const transport = new ControlledTransport([response(), response()]);
    const session = await connectSession(transport);
    const printPromise = session.print(printJob("job-serialized"));
    await transport.rasterWritten;

    const statusPromise = session.status();
    const closePromise = session.close();
    await Promise.resolve();

    expect(transport.writes.map((write) => write[3])).toEqual([
      0x10, 0x10, 0x1b,
    ]);
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
      [0x10, 0x00],
      [0x1b, 0x34],
      [0x10, 0x00],
      [0x10, 0x03],
      [0x10, 0x00],
    ]);
  });

  it("does not let a progress callback stop final protocol cleanup", async () => {
    const transport = recording([
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
    const transport = new CancellingTransport(controller, [
      response(),
      response(),
    ]);
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

  it("uses the detected L1 DPI and swaps adjacent ABF0 raster bytes", async () => {
    const profileReply = response();
    profileReply[6] = 1;
    const transport = new RecordingMakeIdTransport([profileReply]);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));
    const unresolved = makePrinter("l1", "unresolved-l1", "MakeID L1");

    const session = await adapter.connect(unresolved, context);
    const capabilities = await session.capabilities();
    expect(session.printer).toMatchObject({
      model: "MakeID L1 300 DPI",
      connection: expect.objectContaining({ profileId: "l1-abf0-300" }),
    });
    expect(capabilities).toMatchObject({
      dpi: 300,
      rasterWidthPixels: 144,
      maxCopies: 9,
      darkness: { minimum: 0, maximum: 31 },
    });

    const profile = defaultProfileForId("l1-abf0-300");
    const data = Uint8Array.from({ length: 18 }, (_, index) => index);
    const frames = encodeMakeId66Page(
      { widthPixels: 144, heightPixels: 1, bytesPerRow: 18, data },
      profile,
    );
    expect(frames).toHaveLength(1);
    // The literal LZO prefix is at byte 17. Old L1 firmware reads each raster
    // byte pair in reverse order. Host transports on Android and Windows must
    // send this already-transformed frame without another byte-order change.
    expect([...frames[0]!.subarray(18, 24)]).toEqual([1, 0, 3, 2, 5, 4]);
  });

  it("reports the detected raster alignment", async () => {
    const profileReply = extendedResponse({ dpiCode: 0, bytesPerRow: 12 });
    profileReply[38] = 2;
    const transport = new RecordingMakeIdTransport([profileReply]);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));

    const session = await adapter.connect(
      makePrinter("l1", "unresolved-l1", "MakeID L1"),
      context,
    );

    await expect(session.capabilities()).resolves.toMatchObject({
      rasterAlignment: "end",
    });
  });

  it.each([
    ["l1-abf0-203", 96, 171, 3],
    ["l1-abf0-300", 144, 113, 3],
  ] as const)(
    "chunks %s raster rows at its profile limit",
    (profileId, widthPixels, heightPixels, expectedFrames) => {
      const profile = defaultProfileForId(profileId);
      const frames = encodeMakeId66Page(
        pageForWidth(widthPixels, heightPixels),
        profile,
      );

      expect(frames).toHaveLength(expectedFrames);
      expect(frames.map((frame) => frame[15])).toEqual([2, 1, 0]);
    },
  );

  it.each([
    [4, "p31-abf0-288", 288],
    [1, "p31-abf0-300", 300],
  ] as const)(
    "uses P31-family status code %i as profile %s",
    async (dpiCode, profileId, dpi) => {
      const profileReply =
        dpi === 300
          ? extendedResponse({ dpiCode, bytesPerRow: 38 })
          : response();
      profileReply[6] = dpiCode;
      const transport = new RecordingMakeIdTransport([profileReply]);
      const adapter = new MakeIdAdapter(new FakeProvider([], transport));

      const session = await adapter.connect(
        makePrinter("p31", "unresolved-p31", "P31S-Office"),
        context,
      );

      expect(session.printer.connection["profileId"]).toBe(profileId);
      await expect(session.capabilities()).resolves.toMatchObject({
        dpi,
        media: [
          expect.objectContaining({
            id: "makeid-p31-25_4mm-continuous",
            widthMm: 25.4,
          }),
        ],
      });
    },
  );

  it("tries FF00 only after an unresolved L1 rejects ABF0", async () => {
    const failedAbf0 = new RecordingMakeIdTransport([
      new TextEncoder().encode("not an ABF0 response"),
    ]);
    const ff00 = new RecordingMakeIdTransport([
      new TextEncoder().encode("L1-300"),
    ]);
    const provider = new MultiTransportProvider([failedAbf0, ff00]);
    const adapter = new MakeIdAdapter(provider);

    const session = await adapter.connect(
      makePrinter("l1", "unresolved-l1", "MakeID L1"),
      context,
    );

    expect(provider.families).toEqual(["abf0-66", "ff00-escpos"]);
    expect(failedAbf0.open).toBe(false);
    expect(session.printer.connection["profileId"]).toBe("l1-ff00-300");
    const capabilities = await session.capabilities();
    expect(capabilities).toMatchObject({
      dpi: 300,
      maxCopies: 1,
      supportsStatus: false,
    });
    expect(capabilities).not.toHaveProperty("darkness");
  });

  it("rejects more than one copy on the FF00 L1 path", async () => {
    const transport = new RecordingMakeIdTransport([
      new TextEncoder().encode("L1-300"),
    ]);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));
    const target = makePrinter("l1", "l1-ff00-300", "MakeID L1");
    const session = await adapter.connect(target, context);

    await expect(
      session.print({
        id: "ff00-copy-limit",
        printerId: target.id,
        pages: [pageForWidth(144, 1)],
        copies: 2,
      }),
    ).rejects.toMatchObject({
      code: "makeid.invalid-job",
      message: "copies must be from 1 to 1",
    });
  });

  it("prints two FF00 jobs with the captured per-image lead-in", async () => {
    const responses: Uint8Array[] = [new TextEncoder().encode("L1-300")];
    for (let jobIndex = 0; jobIndex < 2; jobIndex += 1) {
      responses.push(
        Uint8Array.of(1),
        Uint8Array.of(2),
        Uint8Array.of(3),
        Uint8Array.of(4),
        Uint8Array.of(5),
        new TextEncoder().encode("OK"),
        Uint8Array.of(0xaa),
      );
    }
    const transport = new RecordingMakeIdTransport(responses);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));
    const target = makePrinter("l1", "l1-ff00-300", "MakeID L1");
    const session = await adapter.connect(target, context);
    const makeJob = (id: string) => ({
      id,
      printerId: target.id,
      pages: [pageForWidth(144, 1)],
      copies: 1,
    });

    await session.print(makeJob("ff00-first"));
    await session.print(makeJob("ff00-second"));

    const sessionOpenWrites = transport.writes.filter(
      (write) =>
        write.length === 4 &&
        write.every((byte, index) => byte === [0x10, 0xff, 0xfe, 0x01][index]),
    );
    expect(sessionOpenWrites).toHaveLength(2);
    const rasterWrites = transport.writes.filter(
      (write) => write[4] === 0x1d && write[5] === 0x76,
    );
    expect(rasterWrites).toHaveLength(2);
    expect([...rasterWrites[0]!.subarray(0, 12)]).toEqual([
      0x10, 0xff, 0xfe, 0x01, 0x1d, 0x76, 0x30, 0, 18, 0, 1, 0,
    ]);
  });

  it("uses a nonempty FF00 status reply only as a responsiveness check", async () => {
    const transport = new RecordingMakeIdTransport([
      new TextEncoder().encode("L1-300"),
      Uint8Array.of(0x10, 0xff, 0x40, 0),
    ]);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));
    const session = await adapter.connect(
      makePrinter("l1", "l1-ff00-300", "MakeID L1"),
      context,
    );

    await expect(session.status()).resolves.toEqual({
      state: "ready",
      message: "Connection is responsive; detailed status is not available",
    });
  });

  it("rejects an empty FF00 status reply and closes the dirty stream", async () => {
    const transport = new RecordingMakeIdTransport([
      new TextEncoder().encode("L1-300"),
      new Uint8Array(),
    ]);
    const adapter = new MakeIdAdapter(new FakeProvider([], transport));
    const session = await adapter.connect(
      makePrinter("l1", "l1-ff00-300", "MakeID L1"),
      context,
    );

    await expect(session.status()).rejects.toMatchObject({
      code: "makeid.protocol",
    });
    expect(transport.open).toBe(false);
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

function recording(
  responses: readonly Uint8Array[] = [],
): RecordingMakeIdTransport {
  return new RecordingMakeIdTransport([response(), ...responses]);
}

function makePrinter(
  suffix: string,
  profileId: "unresolved-l1" | "unresolved-p31" | "l1-abf0-300" | "l1-ff00-300",
  advertisedName: string,
): PrinterDescriptor {
  return {
    id: `makeid:${suffix}`,
    adapterId: "makeid",
    displayName: advertisedName,
    transport: "bluetooth-low-energy",
    connection: { transportDeviceId: suffix, profileId, advertisedName },
  };
}

function page(heightPixels: number): RasterPage {
  return pageForWidth(96, heightPixels);
}

function pageForWidth(widthPixels: number, heightPixels: number): RasterPage {
  const bytesPerRow = widthPixels / 8;
  return {
    widthPixels,
    heightPixels,
    bytesPerRow,
    data: Uint8Array.from(
      { length: heightPixels * bytesPerRow },
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

function extendedResponse(options: {
  dpiCode: number;
  bytesPerRow: number;
}): Uint8Array {
  const bytes = new Uint8Array(44);
  bytes[0] = 0x66;
  bytes[1] = bytes.length;
  bytes[3] = 0x10;
  bytes[6] = options.dpiCode;
  bytes[36] = 1;
  bytes[37] = 3;
  bytes[39] = options.bytesPerRow & 0xff;
  bytes[40] = options.bytesPerRow >> 8;
  bytes[41] = 56;
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

class MultiTransportProvider implements MakeIdTransportProvider {
  readonly families: string[] = [];

  constructor(private readonly transports: MakeIdTransport[]) {}

  async discover(): Promise<readonly MakeIdTransportDevice[]> {
    return [];
  }

  async connect(
    _deviceId: string,
    options: { protocolFamily: "abf0-66" | "ff00-escpos" },
  ): Promise<MakeIdTransport> {
    this.families.push(options.protocolFamily);
    const transport = this.transports.shift();
    if (!transport) throw new Error("No test transport remains");
    return transport;
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
