import { useCallback, useEffect } from "react";

import type { LabelmakerHost } from "./host.js";

type RegisterSystemBackHandler = NonNullable<
  LabelmakerHost["registerSystemBackHandler"]
>;

/** Keep the native subscription separate from the ordered UI close policy. */
function useSystemBackHandler(
  register: RegisterSystemBackHandler | undefined,
  handler: () => boolean,
): void {
  useEffect(() => register?.(handler), [handler, register]);
}

interface LabelmakerSystemBackOptions {
  readonly drawingEditorOpen: boolean;
  readonly closeDrawingEditor: () => void;
  readonly iconLibraryOpen: boolean;
  readonly closeIconLibrary: () => void;
  readonly printerSettingsOpen: boolean;
  readonly closePrinterSettings: () => void;
  readonly addPrinterOpen: boolean;
  readonly discovering: boolean;
  readonly closeAddPrinter: () => void;
  readonly phoneSheetOpen: boolean;
  readonly closePhoneSheet: () => void;
  readonly printMenuOpen: boolean;
  readonly closePrintMenu: () => void;
  readonly printerMenuOpen: boolean;
  readonly closePrinterMenu: () => void;
}

/** Close the top mobile surface before Android Back exits the activity. */
export function useLabelmakerSystemBack(
  register: RegisterSystemBackHandler | undefined,
  options: LabelmakerSystemBackOptions,
): void {
  const handler = useCallback(() => {
    if (options.drawingEditorOpen) {
      options.closeDrawingEditor();
      return true;
    }
    if (options.iconLibraryOpen) {
      options.closeIconLibrary();
      return true;
    }
    if (options.printerSettingsOpen) {
      options.closePrinterSettings();
      return true;
    }
    if (options.addPrinterOpen) {
      if (!options.discovering) options.closeAddPrinter();
      return true;
    }
    if (options.phoneSheetOpen) {
      options.closePhoneSheet();
      return true;
    }
    if (options.printMenuOpen) {
      options.closePrintMenu();
      return true;
    }
    if (options.printerMenuOpen) {
      options.closePrinterMenu();
      return true;
    }
    return false;
  }, [options]);
  useSystemBackHandler(register, handler);
}
