interface NativeMethodMap {
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
  listPrinters: {
    readonly request: Record<string, never>;
    readonly response: unknown;
  };
  discoverPrinters: {
    readonly request: Record<string, never>;
    readonly response: unknown;
  };
  addPrinter: {
    readonly request: { readonly printerId: string };
    readonly response: unknown;
  };
  removePrinter: {
    readonly request: { readonly printerId: string };
    readonly response: unknown;
  };
  getActivePrinterId: {
    readonly request: Record<string, never>;
    readonly response: unknown;
  };
  setActivePrinterId: {
    readonly request: { readonly printerId: string };
    readonly response: null;
  };
  updatePrinterSettings: {
    readonly request: {
      readonly printerId: string;
      readonly settings: unknown;
    };
    readonly response: unknown;
  };
  print: {
    readonly request: { readonly request: unknown };
    readonly response: unknown;
  };
  bluetoothDiscover: {
    readonly request: { readonly timeoutMs: number };
    readonly response: unknown;
  };
  bluetoothConnect: {
    readonly request: { readonly deviceId: string };
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
}

interface NativeReply<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: { readonly code: string; readonly message: string };
}

declare global {
  interface Window {
    readonly webkit?: {
      readonly messageHandlers?: {
        readonly labelmaker?: {
          postMessage(value: unknown): Promise<unknown>;
        };
      };
    };
  }
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

let nextRequestId = 0;

export async function callNative<M extends keyof NativeMethodMap>(
  method: M,
  payload: NativeMethodMap[M]["request"],
): Promise<NativeMethodMap[M]["response"]> {
  const handler = window.webkit?.messageHandlers?.labelmaker;
  if (!handler) {
    throw new NativeBridgeError(
      "NATIVE_BRIDGE_UNAVAILABLE",
      "The iPad host is not available.",
    );
  }
  const rawReply = await handler.postMessage({
    id: `web-${++nextRequestId}`,
    method,
    payload,
  });
  if (!isRecord(rawReply) || typeof rawReply.ok !== "boolean") {
    throw new NativeBridgeError(
      "INVALID_NATIVE_REPLY",
      "The iPad host returned an invalid reply.",
    );
  }
  const reply = rawReply as unknown as NativeReply<
    NativeMethodMap[M]["response"]
  >;
  if (!reply.ok) {
    const code = reply.error?.code ?? "NATIVE_OPERATION_FAILED";
    const message = reply.error?.message ?? "The iPad operation failed.";
    throw new NativeBridgeError(code, message);
  }
  return reply.result as NativeMethodMap[M]["response"];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
