import type { AdapterContext } from "@labelmaker/printing";

type LogMethod = "debug" | "info" | "warn" | "error";
type ConsoleTarget = Pick<Console, LogMethod>;
type ErrorStream = Pick<NodeJS.WriteStream, "on">;

interface OutputChannel {
  available: boolean;
}

export function isClosedOutputError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

function guardOutputStream(stream: ErrorStream, channel: OutputChannel): void {
  stream.on("error", (error) => {
    if (isClosedOutputError(error)) {
      channel.available = false;
      return;
    }
    throw error;
  });
}

export function createProcessLogger(
  consoleTarget: ConsoleTarget = console,
  stdout: ErrorStream = process.stdout,
  stderr: ErrorStream = process.stderr,
): AdapterContext["log"] {
  const standardOutput = { available: true };
  const standardError = { available: true };
  guardOutputStream(stdout, standardOutput);
  guardOutputStream(stderr, standardError);

  const emit = (
    channel: OutputChannel,
    method: LogMethod,
    message: string,
    detail: Readonly<Record<string, unknown>> | undefined,
  ) => {
    if (!channel.available) return;
    try {
      consoleTarget[method](message, detail ?? {});
    } catch (error) {
      if (!isClosedOutputError(error)) throw error;
      channel.available = false;
    }
  };

  return {
    debug: (message, detail) => emit(standardOutput, "debug", message, detail),
    info: (message, detail) => emit(standardOutput, "info", message, detail),
    warn: (message, detail) => emit(standardError, "warn", message, detail),
    error: (message, detail) => emit(standardError, "error", message, detail),
  };
}
