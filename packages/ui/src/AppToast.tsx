import { Check, CircleAlert, Info } from "lucide-react";

import type { Toast } from "./app-state.js";

export function AppToast({
  toast,
  onCancelPrint,
}: {
  readonly toast: Toast | null;
  readonly onCancelPrint?: () => void;
}) {
  if (!toast) return null;
  return (
    <output aria-live="polite" className={`toast ${toast.tone}`}>
      {toast.busy ? (
        <span aria-hidden="true" className="mini-spinner" />
      ) : toast.tone === "success" ? (
        <Check size={17} />
      ) : toast.tone === "error" ? (
        <CircleAlert size={17} />
      ) : (
        <Info size={17} />
      )}{" "}
      <span>{toast.message}</span>
      {toast.busy && onCancelPrint && (
        <button className="toast-action" onClick={onCancelPrint} type="button">
          Cancel print
        </button>
      )}
    </output>
  );
}
