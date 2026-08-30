import type { HostPlatform, HostPresentation } from "@labelmaker/ui";

export const NATIVE_BRIDGE_VERSION = 1;
export const NATIVE_MESSAGE_CHUNK_SIZE = 128 * 1_024;
// A chunk is JSON inside JSON. Use half the frame limit so quotes and
// backslashes can be escaped without making the complete frame too large.
const NATIVE_MESSAGE_CHUNK_DATA_SIZE = 60 * 1_024;
export const NATIVE_MESSAGE_LIMIT = 40 * 1_024 * 1_024;
export const NATIVE_MESSAGE_EXPIRY_MS = 60_000;
export const NATIVE_PENDING_MESSAGE_LIMIT = 8;

export interface NativeHostInfo {
  readonly version: 1;
  readonly platform: Extract<HostPlatform, "ipados" | "android">;
  readonly presentation: Extract<HostPresentation, "mobile-touch">;
  readonly printerStorageKey: string;
  readonly jobIdPrefix: string;
}

export interface NativeMethodMap {
  getHostInfo: {
    readonly request: Record<string, never>;
    readonly response: NativeHostInfo;
  };
  confirmWorkspaceReplacement: {
    readonly request: Record<string, never>;
    readonly response: "save" | "discard" | "cancel";
  };
  openWorkspaceFile: {
    readonly request: Record<string, never>;
    readonly response:
      | { readonly status: "canceled" }
      | {
          readonly status: "selected";
          readonly selectionId: string;
          readonly fileName: string;
          readonly gzipBase64: string;
        };
  };
  acceptOpenedWorkspaceFile: {
    readonly request: { readonly selectionId: string };
    readonly response: null;
  };
  saveWorkspaceFile: {
    readonly request: {
      readonly fileName: string;
      readonly gzipBase64: string;
      readonly saveAs: boolean;
    };
    readonly response:
      | { readonly status: "canceled" }
      | {
          readonly status: "saved";
          readonly fileName: string;
          readonly savedAt: string;
        };
  };
  clearWorkspaceAssociation: {
    readonly request: Record<string, never>;
    readonly response: null;
  };
  loadWorkspaceRecovery: {
    readonly request: Record<string, never>;
    readonly response: unknown;
  };
  storeWorkspaceRecovery: {
    readonly request: { readonly state: unknown };
    readonly response: null;
  };
  bluetoothDiscover: {
    readonly request: {
      readonly timeoutMs: number;
      readonly includeUnpaired: boolean;
    };
    readonly response: unknown;
  };
  bluetoothConnect: {
    readonly request: {
      readonly deviceId: string;
      readonly protocolFamily: "abf0-66" | "ff00-escpos";
    };
    readonly response: unknown;
  };
  bluetoothWrite: {
    readonly request: {
      readonly connectionId: string;
      readonly bytesBase64: string;
    };
    readonly response: null;
  };
  bluetoothRead: {
    readonly request: {
      readonly connectionId: string;
      readonly timeoutMs: number;
    };
    readonly response: unknown;
  };
  bluetoothClose: {
    readonly request: { readonly connectionId: string };
    readonly response: null;
  };
  bluetoothCancel: {
    readonly request: Record<string, never>;
    readonly response: null;
  };
  bluetoothPreserve: {
    readonly request: { readonly deviceId: string };
    readonly response: null;
  };
  bluetoothRelease: {
    readonly request: { readonly deviceId: string };
    readonly response: null;
  };
}

interface NativeRequest {
  readonly version: 1;
  readonly id: string;
  readonly method: keyof NativeMethodMap;
  readonly payload: unknown;
}

interface NativeReply<T> {
  readonly version: 1;
  readonly id: string;
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

interface NativeEvent {
  readonly version: 1;
  readonly type: "event";
  readonly id: string;
  readonly event: "systemBack" | "nativeConnectionsClosed";
}

interface NativeEventResult {
  readonly version: 1;
  readonly type: "event-result";
  readonly id: string;
  readonly handled: boolean;
}

interface AndroidMessagePort {
  postMessage(value: string): void;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
}

declare global {
  interface Window {
    readonly webkit?: {
      readonly messageHandlers?: {
        readonly labelmaker?: { postMessage(value: unknown): Promise<unknown> };
      };
    };
    readonly labelmakerAndroid?: AndroidMessagePort;
  }
}

export interface NativeBridge {
  call<M extends keyof NativeMethodMap>(
    method: M,
    payload: NativeMethodMap[M]["request"],
  ): Promise<NativeMethodMap[M]["response"]>;
  registerSystemBackHandler(handler: () => boolean): () => void;
  registerConnectionResetHandler(handler: () => void): () => void;
}

export class NativeBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeBridgeError";
  }
}

export function createNativeBridge(): NativeBridge {
  const apple = window.webkit?.messageHandlers?.labelmaker;
  if (apple) return new NativeBridgeClient(new AppleRequestTransport(apple));
  const android = window.labelmakerAndroid;
  if (android)
    return new NativeBridgeClient(new AndroidRequestTransport(android));
  throw new NativeBridgeError(
    "NATIVE_BRIDGE_UNAVAILABLE",
    "The mobile host is not available.",
  );
}

interface RequestTransport {
  request(value: NativeRequest): Promise<unknown>;
  registerSystemBackHandler(handler: () => boolean): () => void;
  registerConnectionResetHandler(handler: () => void): () => void;
}

class NativeBridgeClient implements NativeBridge {
  #nextRequestId = 0;

  constructor(private readonly transport: RequestTransport) {}

  async call<M extends keyof NativeMethodMap>(
    method: M,
    payload: NativeMethodMap[M]["request"],
  ): Promise<NativeMethodMap[M]["response"]> {
    validatePayload(method, payload);
    const id = `web-${++this.#nextRequestId}`;
    const rawReply = await this.transport.request({
      version: NATIVE_BRIDGE_VERSION,
      id,
      method,
      payload,
    });
    const reply = validateReply(rawReply, id) as NativeReply<
      NativeMethodMap[M]["response"]
    >;
    if (!reply.ok) {
      throw new NativeBridgeError(
        reply.error?.code ?? "NATIVE_OPERATION_FAILED",
        reply.error?.message ?? "The operation failed on this device.",
      );
    }
    return validateResponse(
      method,
      reply.result,
    ) as NativeMethodMap[M]["response"];
  }

  registerSystemBackHandler(handler: () => boolean): () => void {
    return this.transport.registerSystemBackHandler(handler);
  }

  registerConnectionResetHandler(handler: () => void): () => void {
    return this.transport.registerConnectionResetHandler(handler);
  }
}

class AppleRequestTransport implements RequestTransport {
  constructor(
    private readonly handler: { postMessage(value: unknown): Promise<unknown> },
  ) {}

  request(value: NativeRequest): Promise<unknown> {
    return this.handler.postMessage(value);
  }

  registerSystemBackHandler(): () => void {
    return () => undefined;
  }

  registerConnectionResetHandler(): () => void {
    return () => undefined;
  }
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
}

interface ChunkAccumulator {
  readonly chunks: Array<string | undefined>;
  readonly expires: ReturnType<typeof setTimeout>;
  size: number;
}

class AndroidRequestTransport implements RequestTransport {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #incoming = new Map<string, ChunkAccumulator>();
  #incomingSize = 0;
  #systemBackHandler: (() => boolean) | undefined;
  #connectionResetHandler: (() => void) | undefined;

  constructor(private readonly port: AndroidMessagePort) {
    port.onmessage = (event) => this.receive(event.data);
  }

  request(value: NativeRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#pending.set(value.id, { resolve, reject });
      try {
        this.send(value, `request-${value.id}`);
      } catch (error) {
        this.#pending.delete(value.id);
        reject(error);
      }
    });
  }

  registerSystemBackHandler(handler: () => boolean): () => void {
    this.#systemBackHandler = handler;
    return () => {
      if (this.#systemBackHandler === handler)
        this.#systemBackHandler = undefined;
    };
  }

  registerConnectionResetHandler(handler: () => void): () => void {
    this.#connectionResetHandler = handler;
    return () => {
      if (this.#connectionResetHandler === handler) {
        this.#connectionResetHandler = undefined;
      }
    };
  }

  private receive(rawValue: unknown): void {
    if (
      typeof rawValue !== "string" ||
      rawValue.length > NATIVE_MESSAGE_CHUNK_SIZE
    )
      return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return;
    }
    if (isChunkFrame(parsed)) this.receiveChunk(parsed);
    else this.receiveMessage(parsed);
  }

  private receiveChunk(frame: ChunkFrame): void {
    const maximumChunks = Math.ceil(
      NATIVE_MESSAGE_LIMIT / NATIVE_MESSAGE_CHUNK_DATA_SIZE,
    );
    if (
      !validIdentifier(frame.messageId) ||
      frame.total > maximumChunks ||
      frame.index >= frame.total ||
      frame.data.length > NATIVE_MESSAGE_CHUNK_SIZE
    ) {
      this.dropChunks(frame.messageId);
      return;
    }
    let accumulator = this.#incoming.get(frame.messageId);
    if (!accumulator) {
      if (this.#incoming.size >= NATIVE_PENDING_MESSAGE_LIMIT) return;
      accumulator = {
        chunks: Array.from<string | undefined>({ length: frame.total }),
        expires: setTimeout(
          () => this.dropChunks(frame.messageId),
          NATIVE_MESSAGE_EXPIRY_MS,
        ),
        size: 0,
      };
      this.#incoming.set(frame.messageId, accumulator);
    }
    if (accumulator.chunks.length !== frame.total) {
      this.dropChunks(frame.messageId);
      return;
    }
    if (accumulator.chunks[frame.index] === undefined) {
      if (this.#incomingSize + frame.data.length > NATIVE_MESSAGE_LIMIT) {
        this.dropChunks(frame.messageId);
        return;
      }
      accumulator.chunks[frame.index] = frame.data;
      accumulator.size += frame.data.length;
      this.#incomingSize += frame.data.length;
    }
    if (accumulator.size > NATIVE_MESSAGE_LIMIT) {
      this.dropChunks(frame.messageId);
      return;
    }
    if (accumulator.chunks.every((chunk) => chunk !== undefined)) {
      const serialized = accumulator.chunks.join("");
      this.dropChunks(frame.messageId);
      try {
        const message: unknown = JSON.parse(serialized);
        if (!isChunkFrame(message)) this.receiveMessage(message);
      } catch {
        // A malformed reconstructed message is discarded.
      }
    }
  }

  private receiveMessage(value: unknown): void {
    if (isNativeEvent(value)) {
      if (value.event === "nativeConnectionsClosed") {
        this.#connectionResetHandler?.();
        return;
      }
      let handled = false;
      try {
        handled = this.#systemBackHandler?.() ?? false;
      } finally {
        this.send(
          {
            version: NATIVE_BRIDGE_VERSION,
            type: "event-result",
            id: value.id,
            handled,
          },
          `event-${value.id}`,
        );
      }
      return;
    }
    if (!isRecord(value) || !validIdentifier(value.id)) return;
    const pending = this.#pending.get(value.id);
    if (!pending) return;
    this.#pending.delete(value.id);
    try {
      pending.resolve(validateReply(value, value.id));
    } catch (error) {
      pending.reject(error);
    }
  }

  private send(
    value: NativeRequest | NativeEventResult,
    messageId: string,
  ): void {
    const serialized = JSON.stringify(value);
    if (serialized.length > NATIVE_MESSAGE_LIMIT) {
      throw new NativeBridgeError(
        "NATIVE_MESSAGE_TOO_LARGE",
        "The native request is too large.",
      );
    }
    if (serialized.length <= NATIVE_MESSAGE_CHUNK_SIZE) {
      this.port.postMessage(serialized);
      return;
    }
    const total = Math.ceil(serialized.length / NATIVE_MESSAGE_CHUNK_DATA_SIZE);
    for (let index = 0; index < total; index += 1) {
      const frame: ChunkFrame = {
        type: "chunk",
        messageId,
        index,
        total,
        data: serialized.slice(
          index * NATIVE_MESSAGE_CHUNK_DATA_SIZE,
          (index + 1) * NATIVE_MESSAGE_CHUNK_DATA_SIZE,
        ),
      };
      const serializedFrame = JSON.stringify(frame);
      if (serializedFrame.length > NATIVE_MESSAGE_CHUNK_SIZE) {
        throw new NativeBridgeError(
          "NATIVE_MESSAGE_TOO_LARGE",
          "The native message frame is too large.",
        );
      }
      this.port.postMessage(serializedFrame);
    }
  }

  private dropChunks(messageId: string): void {
    const accumulator = this.#incoming.get(messageId);
    if (!accumulator) return;
    clearTimeout(accumulator.expires);
    this.#incomingSize -= accumulator.size;
    this.#incoming.delete(messageId);
  }
}

interface ChunkFrame {
  readonly type: "chunk";
  readonly messageId: string;
  readonly index: number;
  readonly total: number;
  readonly data: string;
}

function isChunkFrame(value: unknown): value is ChunkFrame {
  return (
    isRecord(value) &&
    value.type === "chunk" &&
    typeof value.messageId === "string" &&
    Number.isSafeInteger(value.index) &&
    Number.isSafeInteger(value.total) &&
    Number(value.index) >= 0 &&
    Number(value.total) > 0 &&
    typeof value.data === "string"
  );
}

function isNativeEvent(value: unknown): value is NativeEvent {
  return (
    isRecord(value) &&
    value.version === NATIVE_BRIDGE_VERSION &&
    value.type === "event" &&
    (value.event === "systemBack" ||
      value.event === "nativeConnectionsClosed") &&
    validIdentifier(value.id)
  );
}

function validateReply(
  value: unknown,
  requestId: string,
): NativeReply<unknown> {
  if (
    !isRecord(value) ||
    value.version !== NATIVE_BRIDGE_VERSION ||
    value.id !== requestId ||
    typeof value.ok !== "boolean" ||
    Object.keys(value).some(
      (key) => !["version", "id", "ok", "result", "error"].includes(key),
    )
  ) {
    throw new NativeBridgeError(
      "INVALID_NATIVE_REPLY",
      "The mobile host returned an invalid reply.",
    );
  }
  const validSuccess =
    value.ok && "result" in value && value.error === undefined;
  const validFailure =
    !value.ok &&
    value.result === undefined &&
    exactRecord(value.error, ["code", "message"]) &&
    boundedString(value.error.code, 100) &&
    boundedString(value.error.message, 1_000);
  if (!validSuccess && !validFailure) {
    throw new NativeBridgeError(
      "INVALID_NATIVE_REPLY",
      "The mobile host returned an invalid error.",
    );
  }
  return value as unknown as NativeReply<unknown>;
}

function validateResponse(
  method: keyof NativeMethodMap,
  value: unknown,
): NativeMethodMap[keyof NativeMethodMap]["response"] {
  switch (method) {
    case "getHostInfo":
      return validateHostInfo(value);
    case "confirmWorkspaceReplacement":
      if (value === "save" || value === "discard" || value === "cancel") {
        return value;
      }
      break;
    case "openWorkspaceFile":
      if (exactRecord(value, ["status"]) && value.status === "canceled") {
        return value;
      }
      if (
        exactRecord(value, [
          "status",
          "selectionId",
          "fileName",
          "gzipBase64",
        ]) &&
        value.status === "selected" &&
        boundedString(value.selectionId, 300) &&
        boundedString(value.fileName, 255) &&
        validBase64(value.gzipBase64, NATIVE_MESSAGE_LIMIT)
      ) {
        return value as NativeMethodMap["openWorkspaceFile"]["response"];
      }
      break;
    case "saveWorkspaceFile":
      if (exactRecord(value, ["status"]) && value.status === "canceled") {
        return value;
      }
      if (
        exactRecord(value, ["status", "fileName", "savedAt"]) &&
        value.status === "saved" &&
        boundedString(value.fileName, 255) &&
        boundedString(value.savedAt, 100)
      ) {
        return value as NativeMethodMap["saveWorkspaceFile"]["response"];
      }
      break;
    case "acceptOpenedWorkspaceFile":
    case "clearWorkspaceAssociation":
    case "storeWorkspaceRecovery":
    case "bluetoothWrite":
    case "bluetoothClose":
    case "bluetoothCancel":
    case "bluetoothPreserve":
    case "bluetoothRelease":
      if (value === null) return value;
      break;
    case "loadWorkspaceRecovery":
      return value;
    case "bluetoothDiscover":
      if (
        Array.isArray(value) &&
        value.every(
          (device) =>
            isRecord(device) &&
            Object.keys(device).every((key) =>
              ["id", "name", "transport"].includes(key),
            ) &&
            boundedString(device.id, 300) &&
            (device.name === null ||
              device.name === undefined ||
              boundedString(device.name, 128)) &&
            (device.transport === "bluetooth-low-energy" ||
              device.transport === "bluetooth-classic"),
        )
      ) {
        return value;
      }
      break;
    case "bluetoothConnect":
      if (
        exactRecord(value, ["connectionId"]) &&
        boundedString(value.connectionId, 300)
      ) {
        return value;
      }
      break;
    case "bluetoothRead":
      if (
        exactRecord(value, ["bytesBase64"]) &&
        validBase64(value.bytesBase64, NATIVE_MESSAGE_LIMIT, true)
      ) {
        return value;
      }
      break;
  }
  throw new NativeBridgeError(
    "INVALID_NATIVE_REPLY",
    "The mobile host returned an invalid reply.",
  );
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => key in value)
  );
}

function validBase64(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumLength &&
    value.length % 4 === 0 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  );
}

function validatePayload(
  method: keyof NativeMethodMap,
  payload: unknown,
): void {
  if (!isRecord(payload)) invalidRequest();
  const keys = Object.keys(payload);
  const exactKeys = (...expected: readonly string[]) =>
    keys.length === expected.length && expected.every((key) => key in payload);
  switch (method) {
    case "getHostInfo":
    case "confirmWorkspaceReplacement":
    case "openWorkspaceFile":
    case "clearWorkspaceAssociation":
    case "loadWorkspaceRecovery":
    case "bluetoothCancel":
      if (!exactKeys()) invalidRequest();
      return;
    case "acceptOpenedWorkspaceFile":
      if (!exactKeys("selectionId") || !boundedString(payload.selectionId, 300))
        invalidRequest();
      return;
    case "saveWorkspaceFile":
      if (
        !exactKeys("fileName", "gzipBase64", "saveAs") ||
        !boundedString(payload.fileName, 255) ||
        !boundedString(payload.gzipBase64, NATIVE_MESSAGE_LIMIT) ||
        typeof payload.saveAs !== "boolean"
      )
        invalidRequest();
      return;
    case "storeWorkspaceRecovery":
      if (!exactKeys("state")) invalidRequest();
      return;
    case "bluetoothDiscover":
      if (
        !exactKeys("timeoutMs", "includeUnpaired") ||
        !positiveInteger(payload.timeoutMs, 60_000) ||
        typeof payload.includeUnpaired !== "boolean"
      )
        invalidRequest();
      return;
    case "bluetoothConnect":
      if (
        !exactKeys("deviceId", "protocolFamily") ||
        !boundedString(payload.deviceId, 300) ||
        (payload.protocolFamily !== "abf0-66" &&
          payload.protocolFamily !== "ff00-escpos")
      )
        invalidRequest();
      return;
    case "bluetoothWrite":
      if (
        !exactKeys("connectionId", "bytesBase64") ||
        !boundedString(payload.connectionId, 300) ||
        typeof payload.bytesBase64 !== "string" ||
        payload.bytesBase64.length > NATIVE_MESSAGE_LIMIT
      )
        invalidRequest();
      return;
    case "bluetoothRead":
      if (
        !exactKeys("connectionId", "timeoutMs") ||
        !boundedString(payload.connectionId, 300) ||
        !positiveInteger(payload.timeoutMs, 60_000)
      )
        invalidRequest();
      return;
    case "bluetoothClose":
      if (
        !exactKeys("connectionId") ||
        !boundedString(payload.connectionId, 300)
      )
        invalidRequest();
      return;
    case "bluetoothPreserve":
    case "bluetoothRelease":
      if (!exactKeys("deviceId") || !boundedString(payload.deviceId, 300))
        invalidRequest();
  }
}

function invalidRequest(): never {
  throw new NativeBridgeError(
    "INVALID_NATIVE_REQUEST",
    "The native request is invalid.",
  );
}

function boundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function positiveInteger(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= maximum
  );
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function validateHostInfo(value: unknown): NativeHostInfo {
  if (
    !exactRecord(value, [
      "version",
      "platform",
      "presentation",
      "printerStorageKey",
      "jobIdPrefix",
    ]) ||
    value.version !== NATIVE_BRIDGE_VERSION ||
    (value.platform !== "ipados" && value.platform !== "android") ||
    value.presentation !== "mobile-touch" ||
    !boundedString(value.printerStorageKey, 120) ||
    !boundedString(value.jobIdPrefix, 40)
  ) {
    throw new NativeBridgeError(
      "INVALID_HOST_INFO",
      "The mobile host information is invalid.",
    );
  }
  return value as unknown as NativeHostInfo;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
