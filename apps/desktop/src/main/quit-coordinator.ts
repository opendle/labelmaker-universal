export interface QuitPreparation {
  readonly closePrinters: () => Promise<void>;
  readonly flushRecovery: () => Promise<void>;
  readonly onPrinterCloseError: (error: unknown) => void;
  readonly onRecoveryError: (error: unknown) => void;
  readonly readyToQuit: () => void;
}

/** Save recovery state before quit without waiting for printer transports. */
export function prepareToQuit(options: QuitPreparation): void {
  void options.closePrinters().catch(options.onPrinterCloseError);
  void options
    .flushRecovery()
    .catch(options.onRecoveryError)
    .finally(options.readyToQuit);
}
