import { describe, expect, it } from "vitest";

import {
  MacOsMakeIdTransportProvider,
  parseDiscoveryOutput,
} from "./macos-transport.js";
import { MakeIdTransportTimeoutError } from "./transport.js";

const ABF0 = { protocolFamily: "abf0-66" } as const;
const FF00 = { protocolFamily: "ff00-escpos" } as const;

describe("MacOsMakeIdTransportProvider", () => {
  it("validates paired-device discovery output", () => {
    expect(
      parseDiscoveryOutput(
        JSON.stringify([{ id: "01-23-45-67-89-ab", name: "YichipFPGA-1308" }]),
      ),
    ).toEqual([
      {
        id: "01:23:45:67:89:AB",
        name: "YichipFPGA-1308",
        transport: "bluetooth-classic",
      },
    ]);
    expect(
      parseDiscoveryOutput(
        JSON.stringify([
          {
            id: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
            name: "YichipFPGA-1308",
          },
          { id: "macos-bt-0123456789abcdef01234567" },
        ]),
      ),
    ).toEqual([
      {
        id: "macos-ble-01234567-89ab-cdef-0123-456789abcdef",
        name: "YichipFPGA-1308",
        transport: "bluetooth-low-energy",
      },
      {
        id: "macos-bt-0123456789abcdef01234567",
        transport: "bluetooth-classic",
      },
    ]);
    expect(() => parseDiscoveryOutput('[{"id":"not-an-address"}]')).toThrow(
      /invalid/,
    );
  });

  it("preserves a discovered CoreBluetooth peripheral ID for connect", async () => {
    const peripheralId = "macos-ble-01234567-89ab-cdef-0123-456789abcdef";
    const helper = `
      if (process.argv[1] === "discover") {
        process.stdout.write(JSON.stringify([{ id: ${JSON.stringify(peripheralId)}, name: "YichipFPGA-1308" }]));
      } else if (process.argv[1] === "connect" && process.argv[2] === ${JSON.stringify(peripheralId)} && process.argv[3] === "abf0-66") {
        process.stderr.write("READY\\n");
        process.stdin.resume();
      } else process.exit(8);
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    const devices = await provider.discover({ timeoutMs: 1_000 });
    expect(devices).toEqual([
      {
        id: peripheralId,
        name: "YichipFPGA-1308",
        transport: "bluetooth-low-energy",
      },
    ]);
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");
    const transport = await provider.connect(device.id, ABF0);
    await transport.close();
  });

  it("discovers through the helper process and separates stream frames", async () => {
    const response = Buffer.alloc(36);
    response[0] = 0x66;
    response[1] = 36;
    response[3] = 0x10;
    const helper = `
      const mode = process.argv[1];
      if (mode === "discover") {
        process.stdout.write(JSON.stringify([{ id: "01:23:45:67:89:AB", name: "YichipFPGA-1308" }]));
      } else {
        if (mode !== "connect") process.exit(8);
        process.stderr.write("READY\\n");
        process.stdin.once("data", () => {
          const frame = Buffer.from(${JSON.stringify([...response])});
          process.stdout.write(frame.subarray(0, 7));
          process.stdout.write(Buffer.concat([frame.subarray(7), frame]));
        });
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    const devices = await provider.discover({ timeoutMs: 1_000 });
    expect(devices).toEqual([
      {
        id: expect.stringMatching(/^macos-bt-[0-9a-f]{24}$/),
        name: "YichipFPGA-1308",
        transport: "bluetooth-classic",
      },
    ]);
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");
    const transport = await provider.connect(device.id, ABF0);
    try {
      await transport.write(Uint8Array.of(0x66, 6, 0, 0x10, 0, 0x84));
      await expect(transport.read({ timeoutMs: 1_000 })).resolves.toEqual(
        Uint8Array.from(response),
      );
      await expect(transport.read({ timeoutMs: 1_000 })).resolves.toEqual(
        Uint8Array.from(response),
      );
    } finally {
      await transport.close();
    }
  });

  it("passes FF00 selection and returns raw command replies", async () => {
    const savedId = "macos-bt-0123456789abcdef01234567";
    const helper = `
      if (process.argv[1] !== "connect" || process.argv[2] !== ${JSON.stringify(savedId)} || process.argv[3] !== "ff00-escpos") process.exit(8);
      process.stderr.write("READY\\n");
      process.stdin.once("data", () => process.stdout.write(Buffer.from([0x66, 2, 0])));
      process.stdin.resume();
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    const transport = await provider.connect(savedId, FF00);
    try {
      await transport.write(Uint8Array.of(0x10, 0xff, 0x20, 0xf0));
      await expect(transport.read({ timeoutMs: 1_000 })).resolves.toEqual(
        Uint8Array.of(0x66, 2, 0),
      );
    } finally {
      await transport.close();
    }
  });

  it("resynchronizes after noise and invalid frame headers", async () => {
    const response = Buffer.alloc(36);
    response[0] = 0x66;
    response[1] = 36;
    response[3] = 0x10;
    const helper = `
      if (process.argv[1] === "discover") {
        process.stdout.write('[{"id":"01:23:45:67:89:AB","name":"YichipFPGA-1308"}]');
      } else {
        if (process.argv[1] !== "connect") process.exit(8);
        process.stderr.write("READY\\n");
        process.stdin.once("data", () => {
          const valid = Buffer.from(${JSON.stringify([...response])});
          const noise = Buffer.concat([
            Buffer.alloc(10_000, 1),
            Buffer.from([0x66, 2, 0, 0x66, 0xff, 0xff, 0x66, 0, 1, 0xaa]),
          ]);
          process.stdout.write(Buffer.concat([noise, valid]));
        });
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });
    const devices = await provider.discover({ timeoutMs: 1_000 });
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");
    const transport = await provider.connect(device.id, ABF0);

    try {
      await transport.write(Uint8Array.of(0x66, 6, 0, 0x10, 0, 0x84));
      await expect(transport.read({ timeoutMs: 1_000 })).resolves.toEqual(
        Uint8Array.from(response),
      );
    } finally {
      await transport.close();
    }
  });

  it("bypasses warm-up for a saved Classic printer ID", async () => {
    const savedId = "macos-bt-0123456789abcdef01234567";
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const invocationsPath = join(directory, "invocations");
    const helper = `
      require("node:fs").appendFileSync(${JSON.stringify(invocationsPath)}, process.argv[1] + "\\n");
      if (process.argv[1] !== "connect") process.exit(8);
      if (process.argv[2] !== ${JSON.stringify(savedId)}) process.exit(8);
      process.stderr.write("READY\\n");
      process.stdin.resume();
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    try {
      const transport = await provider.connect(savedId, ABF0);
      await transport.close();
      await expect(readFile(invocationsPath, "utf8")).resolves.toBe(
        "connect\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("warms up CoreBluetooth before it connects a saved peripheral", async () => {
    const savedId = "macos-ble-fedcba98-7654-3210-fedc-ba9876543210";
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const invocationsPath = join(directory, "invocations");
    const helper = `
      const fs = require("node:fs");
      const mode = process.argv[1];
      fs.appendFileSync(${JSON.stringify(invocationsPath)}, process.argv.slice(1).join(" ") + "\\n");
      if (mode === "discover") {
        if (process.argv[2] !== "--include-unpaired") process.exit(8);
        process.stdout.write("[]");
      } else if (mode === "connect" && process.argv[2] === ${JSON.stringify(savedId)}) {
        process.stderr.write("READY\\n");
        process.stdin.resume();
      } else process.exit(8);
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    try {
      const transport = await provider.connect(savedId.toUpperCase(), ABF0);
      await transport.close();
      await expect(readFile(invocationsPath, "utf8")).resolves.toBe(
        `discover --include-unpaired\nconnect ${savedId} abf0-66\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("waits for the native late-open grace period before READY", async () => {
    const savedId = "macos-bt-0123456789abcdef01234567";
    const helper = `
      if (process.argv[1] === "connect") {
        process.stderr.write("The initial RFCOMM open returned kIOReturnError\\n");
        setTimeout(() => process.stderr.write("READY\\n"), 25);
        process.stdin.resume();
      } else process.exit(8);
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
      connectTimeoutMs: 500,
    });

    const transport = await provider.connect(savedId, ABF0);
    await transport.close();
  });

  it("passes the unpaired discovery request to the native helper", async () => {
    const helper = `
      if (process.argv[1] !== "discover" || process.argv[2] !== "--include-unpaired") process.exit(8);
      process.stdout.write(JSON.stringify([{ id: "01:23:45:67:89:AB", name: "YichipFPGA-1308" }]));
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    await expect(
      provider.discover({ timeoutMs: 1_000, includeUnpaired: true }),
    ).resolves.toEqual([
      {
        id: expect.stringMatching(/^macos-bt-[0-9a-f]{24}$/),
        name: "YichipFPGA-1308",
        transport: "bluetooth-classic",
      },
    ]);
  });

  it("bounds a read when the helper does not reply", async () => {
    const discoveryHelper = `
      if (process.argv[1] === "discover") process.stdout.write('[{"id":"01:23:45:67:89:AB","name":"YichipFPGA-1308"}]');
      else {
        process.stderr.write("READY\\n");
        process.stdin.resume();
      }
    `;
    const boundedProvider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", discoveryHelper],
    });
    const devices = await boundedProvider.discover({ timeoutMs: 1_000 });
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");
    const transport = await boundedProvider.connect(device.id, ABF0);
    try {
      await expect(transport.read({ timeoutMs: 10 })).rejects.toBeInstanceOf(
        MakeIdTransportTimeoutError,
      );
    } finally {
      await transport.close();
    }
  });

  it("retries a transient RFCOMM connection failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const counterPath = join(directory, "attempts");
    const helper = `
      const fs = require("node:fs");
      const mode = process.argv[1];
      if (mode === "discover") {
        process.stdout.write('[{"id":"01:23:45:67:89:AB","name":"YichipFPGA-1308"}]');
      } else {
        if (mode !== "connect") process.exit(8);
        let attempt = 0;
        try { attempt = Number(fs.readFileSync(${JSON.stringify(counterPath)}, "utf8")); } catch {}
        attempt += 1;
        fs.writeFileSync(${JSON.stringify(counterPath)}, String(attempt));
        if (attempt === 1) {
          process.stderr.write("The RFCOMM channel is still closing\\n");
          process.exit(9);
        }
        process.stderr.write("READY\\n");
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    try {
      const devices = await provider.discover({ timeoutMs: 1_000 });
      const device = devices[0];
      if (!device) throw new Error("Expected a discovery result");
      const transport = await provider.connect(device.id, ABF0);
      await transport.close();
      await expect(readFile(counterPath, "utf8")).resolves.toBe("2");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("stops after two complete RFCOMM connection failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const counterPath = join(directory, "attempts");
    const helper = `
      const fs = require("node:fs");
      if (process.argv[1] !== "connect") process.exit(8);
      let attempt = 0;
      try { attempt = Number(fs.readFileSync(${JSON.stringify(counterPath)}, "utf8")); } catch {}
      fs.writeFileSync(${JSON.stringify(counterPath)}, String(attempt + 1));
      process.stderr.write("RFCOMM open failed\\n");
      process.exit(9);
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    try {
      await expect(
        provider.connect("macos-bt-0123456789abcdef01234567", ABF0),
      ).rejects.toThrow("RFCOMM open failed");
      await expect(readFile(counterPath, "utf8")).resolves.toBe("2");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("bounds all RFCOMM connection attempts with one deadline", async () => {
    const helper = `
      if (process.argv[1] === "discover") {
        process.stdout.write('[{"id":"01:23:45:67:89:AB","name":"YichipFPGA-1308"}]');
      } else {
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
      connectTimeoutMs: 5_000,
      totalConnectTimeoutMs: 100,
    });
    const devices = await provider.discover({ timeoutMs: 1_000 });
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");

    const startedAt = Date.now();
    await expect(provider.connect(device.id, ABF0)).rejects.toBeInstanceOf(
      MakeIdTransportTimeoutError,
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("does not connect when the CoreBluetooth warm-up fails", async () => {
    const savedId = "macos-ble-fedcba98-7654-3210-fedc-ba9876543210";
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const invocationsPath = join(directory, "invocations");
    const helper = `
      const mode = process.argv[1];
      require("node:fs").appendFileSync(${JSON.stringify(invocationsPath)}, mode + "\\n");
      if (mode === "discover") {
        process.stderr.write("CoreBluetooth scan failed\\n");
        process.exit(9);
      }
      process.stderr.write("READY\\n");
      process.stdin.resume();
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
      totalConnectTimeoutMs: 100,
    });

    try {
      await expect(provider.connect(savedId, ABF0)).rejects.toThrow(
        "MakeID Bluetooth warm-up failed",
      );
      await expect(readFile(invocationsPath, "utf8")).resolves.toBe(
        "discover\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("aborts a CoreBluetooth warm-up without starting connect", async () => {
    const savedId = "macos-ble-fedcba98-7654-3210-fedc-ba9876543210";
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const invocationsPath = join(directory, "invocations");
    const helper = `
      const mode = process.argv[1];
      require("node:fs").appendFileSync(${JSON.stringify(invocationsPath)}, mode + "\\n");
      if (mode === "discover") setInterval(() => {}, 1_000);
      else {
        process.stderr.write("READY\\n");
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
      totalConnectTimeoutMs: 5_000,
    });
    const controller = new AbortController();
    const reason = new Error("Test warm-up cancellation");

    try {
      const connection = provider.connect(savedId, ABF0, controller.signal);
      setTimeout(() => controller.abort(reason), 100);
      await expect(connection).rejects.toBe(reason);
      await expect(readFile(invocationsPath, "utf8")).resolves.toBe(
        "discover\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("bounds CoreBluetooth warm-up and connect with one deadline", async () => {
    const savedId = "macos-ble-fedcba98-7654-3210-fedc-ba9876543210";
    const directory = await mkdtemp(join(tmpdir(), "makeid-transport-test-"));
    const invocationsPath = join(directory, "invocations");
    const helper = `
      const mode = process.argv[1];
      require("node:fs").appendFileSync(${JSON.stringify(invocationsPath)}, mode + "\\n");
      if (mode === "discover") setInterval(() => {}, 1_000);
      else {
        process.stderr.write("READY\\n");
        process.stdin.resume();
      }
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
      connectTimeoutMs: 5_000,
      totalConnectTimeoutMs: 100,
    });

    try {
      const startedAt = Date.now();
      await expect(provider.connect(savedId, ABF0)).rejects.toBeInstanceOf(
        MakeIdTransportTimeoutError,
      );
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      await expect(readFile(invocationsPath, "utf8")).resolves.toBe(
        "discover\n",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
