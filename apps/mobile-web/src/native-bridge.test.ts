// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createNativeBridge,
  NATIVE_MESSAGE_CHUNK_SIZE,
} from "./native-bridge.js";

class TestAndroidPort {
  readonly sent: string[] = [];
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;

  postMessage(value: string): void {
    this.sent.push(value);
  }

  emit(value: unknown): void {
    this.onmessage?.({ data: value });
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native bridge version 1", () => {
  it("requires the native reply to contain the matching request ID", async () => {
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async () => ({
            version: 1,
            id: "another-request",
            ok: true,
            result: null,
          }),
        },
      },
    });

    await expect(
      createNativeBridge().call("clearWorkspaceAssociation", {}),
    ).rejects.toMatchObject({ code: "INVALID_NATIVE_REPLY" });
  });

  it("rejects malformed successful result types", async () => {
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => ({
            version: 1,
            id: (request as { id: string }).id,
            ok: true,
            result: "unexpected",
          }),
        },
      },
    });

    await expect(
      createNativeBridge().call("clearWorkspaceAssociation", {}),
    ).rejects.toMatchObject({ code: "INVALID_NATIVE_REPLY" });
  });

  it("rejects a selected workspace with invalid base64", async () => {
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => ({
            version: 1,
            id: (request as { id: string }).id,
            ok: true,
            result: {
              status: "selected",
              selectionId: "selection-1",
              fileName: "Labels.lbl",
              gzipBase64: "not base64",
            },
          }),
        },
      },
    });

    await expect(
      createNativeBridge().call("openWorkspaceFile", {}),
    ).rejects.toMatchObject({ code: "INVALID_NATIVE_REPLY" });
  });

  it("puts version 1 and a bounded ID in an Apple request", async () => {
    const requests: unknown[] = [];
    vi.stubGlobal("webkit", {
      messageHandlers: {
        labelmaker: {
          postMessage: async (request: unknown) => {
            requests.push(request);
            const id = (request as { id: string }).id;
            return { version: 1, id, ok: true, result: null };
          },
        },
      },
    });

    await createNativeBridge().call("clearWorkspaceAssociation", {});

    expect(requests).toEqual([
      {
        version: 1,
        id: expect.stringMatching(/^[A-Za-z0-9._:-]{1,64}$/),
        method: "clearWorkspaceAssociation",
        payload: {},
      },
    ]);
  });

  it("keeps each complete Android frame inside 128 KiB", async () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    const pending = createNativeBridge().call("bluetoothWrite", {
      connectionId: "connection-1",
      bytesBase64: "a".repeat(200_000),
    });

    expect(port.sent.length).toBeGreaterThan(1);
    expect(
      port.sent.every((frame) => frame.length <= NATIVE_MESSAGE_CHUNK_SIZE),
    ).toBe(true);
    const chunks = port.sent.map(
      (frame) => JSON.parse(frame) as { index: number; data: string },
    );
    const request = JSON.parse(
      chunks
        .toSorted((left, right) => left.index - right.index)
        .map((chunk) => chunk.data)
        .join(""),
    ) as { id: string };
    port.emit(
      JSON.stringify({
        version: 1,
        id: request.id,
        ok: true,
        result: null,
      }),
    );

    await expect(pending).resolves.toBeNull();
  });

  it("keeps escaped Android chunk frames inside 128 KiB", async () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    const pending = createNativeBridge().call("storeWorkspaceRecovery", {
      state: { text: '"\\'.repeat(100_000) },
    });

    expect(port.sent.length).toBeGreaterThan(1);
    expect(
      port.sent.every((frame) => frame.length <= NATIVE_MESSAGE_CHUNK_SIZE),
    ).toBe(true);
    const chunks = port.sent.map(
      (frame) => JSON.parse(frame) as { index: number; data: string },
    );
    const request = JSON.parse(
      chunks
        .toSorted((left, right) => left.index - right.index)
        .map((chunk) => chunk.data)
        .join(""),
    ) as { id: string };
    port.emit(
      JSON.stringify({
        version: 1,
        id: request.id,
        ok: true,
        result: null,
      }),
    );

    await expect(pending).resolves.toBeNull();
  });

  it("reports whether the shared UI handled Android system Back", () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    const bridge = createNativeBridge();
    bridge.registerSystemBackHandler(() => true);

    port.emit(
      JSON.stringify({
        version: 1,
        type: "event",
        id: "native-back-1",
        event: "systemBack",
      }),
    );

    expect(JSON.parse(port.sent[0] ?? "null")).toEqual({
      version: 1,
      type: "event-result",
      id: "native-back-1",
      handled: true,
    });
  });

  it("reports when Android closed native printer connections", () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    const bridge = createNativeBridge();
    const reset = vi.fn();
    bridge.registerConnectionResetHandler(reset);

    port.emit(
      JSON.stringify({
        version: 1,
        type: "event",
        id: "native-connections-1",
        event: "nativeConnectionsClosed",
      }),
    );

    expect(reset).toHaveBeenCalledOnce();
    expect(port.sent).toEqual([]);
  });

  it("reconstructs a large Android reply from bounded frames", async () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    const pending = createNativeBridge().call("loadWorkspaceRecovery", {});
    const request = JSON.parse(port.sent[0] ?? "null") as { id: string };
    const result = { value: "r".repeat(200_000) };
    const serialized = JSON.stringify({
      version: 1,
      id: request.id,
      ok: true,
      result,
    });
    const dataSize = 120 * 1_024;
    const total = Math.ceil(serialized.length / dataSize);
    const frames = Array.from({ length: total }, (_, index) =>
      JSON.stringify({
        type: "chunk",
        messageId: "reply-web-1",
        index,
        total,
        data: serialized.slice(index * dataSize, (index + 1) * dataSize),
      }),
    );
    expect(
      frames.every((frame) => frame.length <= NATIVE_MESSAGE_CHUNK_SIZE),
    ).toBe(true);

    for (const frame of frames.toReversed()) port.emit(frame);

    await expect(pending).resolves.toEqual(result);
  });

  it("ignores an incoming Android frame larger than 128 KiB", async () => {
    vi.stubGlobal("webkit", undefined);
    const port = new TestAndroidPort();
    vi.stubGlobal("labelmakerAndroid", port);
    let settled = false;
    const pending = createNativeBridge()
      .call("clearWorkspaceAssociation", {})
      .finally(() => {
        settled = true;
      });
    const request = JSON.parse(port.sent[0] ?? "null") as { id: string };
    const reply = JSON.stringify({
      version: 1,
      id: request.id,
      ok: true,
      result: null,
    });

    port.emit(reply + " ".repeat(NATIVE_MESSAGE_CHUNK_SIZE));
    await Promise.resolve();
    expect(settled).toBe(false);

    port.emit(reply);
    await expect(pending).resolves.toBeNull();
  });
});
