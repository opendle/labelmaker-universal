import { describe, expect, it } from "vitest";

import {
  MacOsMakeIdTransportProvider,
  parseDiscoveryOutput,
} from "./macos-transport.js";
import { MakeIdTransportTimeoutError } from "./transport.js";

describe("MacOsMakeIdTransportProvider", () => {
  it("validates paired-device discovery output", () => {
    expect(
      parseDiscoveryOutput(
        JSON.stringify([{ id: "01-23-45-67-89-ab", name: "YichipFPGA-1308" }]),
      ),
    ).toEqual([{ id: "01:23:45:67:89:AB", name: "YichipFPGA-1308" }]);
    expect(() => parseDiscoveryOutput('[{"id":"not-an-address"}]')).toThrow(
      /invalid/,
    );
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
      },
    ]);
    const device = devices[0];
    if (!device) throw new Error("Expected a discovery result");
    const transport = await provider.connect(device.id);
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

  it("resynchronizes after noise and invalid frame headers", async () => {
    const response = Buffer.alloc(36);
    response[0] = 0x66;
    response[1] = 36;
    response[3] = 0x10;
    const helper = `
      if (process.argv[1] === "discover") {
        process.stdout.write('[{"id":"01:23:45:67:89:AB","name":"YichipFPGA-1308"}]');
      } else {
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
    const transport = await provider.connect(device.id);

    try {
      await transport.write(Uint8Array.of(0x66, 6, 0, 0x10, 0, 0x84));
      await expect(transport.read({ timeoutMs: 1_000 })).resolves.toEqual(
        Uint8Array.from(response),
      );
    } finally {
      await transport.close();
    }
  });

  it("connects a saved opaque printer ID without prior discovery", async () => {
    const savedId = "macos-bt-0123456789abcdef01234567";
    const helper = `
      if (process.argv[1] !== "connect" || process.argv[2] !== ${JSON.stringify(savedId)}) process.exit(8);
      process.stderr.write("READY\\n");
      process.stdin.resume();
    `;
    const provider = new MacOsMakeIdTransportProvider({
      helperPath: process.execPath,
      helperArguments: ["-e", helper],
    });

    const transport = await provider.connect(savedId);
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
    const transport = await boundedProvider.connect(device.id);
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
      const transport = await provider.connect(device.id);
      await transport.close();
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
    await expect(provider.connect(device.id)).rejects.toBeInstanceOf(
      MakeIdTransportTimeoutError,
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
