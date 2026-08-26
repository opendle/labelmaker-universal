import type {
  PrinterDescriptor,
  PrinterSession,
  PrinterState,
} from "@labelmaker/printing";

type OpenPrinterSession = (
  printer: PrinterDescriptor,
) => Promise<PrinterSession>;

interface SessionEntry {
  readonly pending: Promise<PrinterSession>;
  closePromise?: Promise<void>;
}

/**
 * Own the pending and open sessions for one desktop process.
 *
 * Each connection has a stable entry. A late rejection removes the entry only
 * when it is still current, so it cannot remove a replacement connection. A
 * discarded pending connection is closed if it later opens successfully.
 */
export class PrinterSessionManager {
  readonly #entries = new Map<string, SessionEntry>();
  readonly #sessionEntries = new WeakMap<PrinterSession, SessionEntry>();
  readonly #sessionCloses = new WeakMap<PrinterSession, Promise<void>>();

  constructor(private readonly openSession: OpenPrinterSession) {}

  has(printerId: string): boolean {
    return this.#entries.has(printerId);
  }

  get(printer: PrinterDescriptor): Promise<PrinterSession> {
    const existing = this.#entries.get(printer.id);
    if (existing) return existing.pending;

    const entry: SessionEntry = {
      pending: Promise.resolve()
        .then(() => this.openSession(printer))
        .then((session) => {
          this.#sessionEntries.set(session, entry);
          return session;
        }),
    };
    this.#entries.set(printer.id, entry);
    void entry.pending.catch(() => {
      if (this.#entries.get(printer.id) === entry) {
        this.#entries.delete(printer.id);
      }
    });
    return entry.pending;
  }

  /**
   * Remove and close a cached session.
   *
   * Pass the session when invalidating the result of an earlier operation. In
   * that form, this method cannot remove a newer replacement for the printer.
   */
  async discard(
    printerId: string,
    expectedSession?: PrinterSession,
  ): Promise<void> {
    const entry = expectedSession
      ? this.#sessionEntries.get(expectedSession)
      : this.#entries.get(printerId);
    if (!entry) return;
    if (this.#entries.get(printerId) === entry) {
      this.#entries.delete(printerId);
    }
    await this.#closeEntry(entry);
  }

  async closeAll(): Promise<void> {
    const entries = [...this.#entries.entries()];
    for (const [printerId, entry] of entries) {
      if (this.#entries.get(printerId) === entry) {
        this.#entries.delete(printerId);
      }
    }
    await Promise.all(entries.map(([, entry]) => this.#closeEntry(entry)));
  }

  #closeEntry(entry: SessionEntry): Promise<void> {
    entry.closePromise ??= entry.pending
      .then((session) => this.#closeSession(session))
      .catch(() => undefined);
    return entry.closePromise;
  }

  #closeSession(session: PrinterSession): Promise<void> {
    const existing = this.#sessionCloses.get(session);
    if (existing) return existing;
    const closing = Promise.resolve()
      .then(() => session.close())
      .catch(() => undefined);
    this.#sessionCloses.set(session, closing);
    return closing;
  }
}

export interface PrinterReadinessOptions {
  /** Maximum number of distinct sessions to try. */
  readonly maxSessionAttempts?: number;
  /** One total deadline for connection attempts and status polling. */
  readonly readinessTimeoutMs?: number;
  readonly busyRetryDelayMs?: number;
  readonly connectingRetryDelayMs?: number;
  /** Test seams for deterministic deadline checks. */
  readonly now?: () => number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const DEFAULT_READINESS_OPTIONS = {
  maxSessionAttempts: 2,
  readinessTimeoutMs: 5_000,
  busyRetryDelayMs: 250,
  connectingRetryDelayMs: 100,
} as const;

type DiscardPrinterSession = (
  printerId: string,
  expectedSession?: PrinterSession,
) => Promise<void>;

/**
 * Get a session which answered a fresh ready-status query.
 *
 * Busy and connecting are healthy transitional states, so they are polled on
 * the same session. A broken session is discarded before one reconnect. An
 * attention state gets one reconnect because MakeID can use it for an
 * unavailable status response; a second attention state is reported.
 */
export async function getReadyPrinterSession(
  printer: PrinterDescriptor,
  getSession: OpenPrinterSession,
  discardSession: DiscardPrinterSession,
  options: PrinterReadinessOptions = {},
): Promise<PrinterSession> {
  const resolved = resolveReadinessOptions(options);
  const deadline = resolved.now() + resolved.readinessTimeoutMs;
  let lastError: Error = new Error("The printer could not be connected");

  for (let attempt = 0; attempt < resolved.maxSessionAttempts; attempt += 1) {
    let session: PrinterSession;
    try {
      session = await getSession(printer);
    } catch (error) {
      lastError = asError(error);
      if (!canRetry(attempt, deadline, resolved)) break;
      continue;
    }

    let completedProbe = false;
    while (true) {
      if (completedProbe && resolved.now() >= deadline) throw lastError;

      let state: PrinterState;
      let message: string | undefined;
      try {
        const status = await session.status();
        state = status.state;
        message = status.message;
      } catch (error) {
        lastError = asError(error);
        await discardSession(printer.id, session);
        break;
      }
      completedProbe = true;

      if (state === "ready") return session;
      lastError = new Error(message ?? `Printer is ${state}`);

      if (state === "busy" || state === "connecting") {
        const remainingMs = deadline - resolved.now();
        if (remainingMs <= 0) throw lastError;
        const stateDelayMs =
          state === "busy"
            ? resolved.busyRetryDelayMs
            : resolved.connectingRetryDelayMs;
        await resolved.sleep(Math.min(stateDelayMs, remainingMs));
        continue;
      }

      if (state === "attention") {
        if (!canRetry(attempt, deadline, resolved)) throw lastError;
        await discardSession(printer.id, session);
        break;
      }

      // Disconnected and error states describe a session which is not healthy.
      await discardSession(printer.id, session);
      break;
    }

    if (!canRetry(attempt, deadline, resolved)) break;
  }

  throw lastError;
}

function resolveReadinessOptions(options: PrinterReadinessOptions) {
  const resolved = {
    maxSessionAttempts:
      options.maxSessionAttempts ??
      DEFAULT_READINESS_OPTIONS.maxSessionAttempts,
    readinessTimeoutMs:
      options.readinessTimeoutMs ??
      DEFAULT_READINESS_OPTIONS.readinessTimeoutMs,
    busyRetryDelayMs:
      options.busyRetryDelayMs ?? DEFAULT_READINESS_OPTIONS.busyRetryDelayMs,
    connectingRetryDelayMs:
      options.connectingRetryDelayMs ??
      DEFAULT_READINESS_OPTIONS.connectingRetryDelayMs,
    now: options.now ?? Date.now,
    sleep:
      options.sleep ??
      ((delayMs: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, delayMs))),
  };
  if (
    !Number.isInteger(resolved.maxSessionAttempts) ||
    resolved.maxSessionAttempts < 1 ||
    !Number.isInteger(resolved.readinessTimeoutMs) ||
    resolved.readinessTimeoutMs < 0 ||
    !Number.isInteger(resolved.busyRetryDelayMs) ||
    resolved.busyRetryDelayMs < 0 ||
    !Number.isInteger(resolved.connectingRetryDelayMs) ||
    resolved.connectingRetryDelayMs < 0
  ) {
    throw new RangeError("Printer session retry options are invalid");
  }
  return resolved;
}

function canRetry(
  attempt: number,
  deadline: number,
  options: ReturnType<typeof resolveReadinessOptions>,
): boolean {
  return attempt + 1 < options.maxSessionAttempts && options.now() < deadline;
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("The printer could not be connected");
}
