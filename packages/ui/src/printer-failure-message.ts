const REMOTE_ERROR_PREFIX =
  /^Error invoking remote method '[^']+':\s*(?:[A-Za-z][A-Za-z0-9]*Error:\s*)?/i;

export function printerFailureMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.replace(REMOTE_ERROR_PREFIX, "").trim();
  return !message || message.length > 240 ? fallback : message;
}

export function remotePrinterFailureMessage(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error) || !REMOTE_ERROR_PREFIX.test(error.message)) {
    return fallback;
  }
  return printerFailureMessage(error, fallback);
}
