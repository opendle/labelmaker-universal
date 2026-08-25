import type { ReactNode } from "react";

export function IconButton({
  label,
  children,
  disabled = false,
  initialFocus = false,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="icon-button"
      data-autofocus={initialFocus || undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function SelectionHandles() {
  return (
    <>
      <i className="handle nw" />
      <i className="handle ne" />
      <i className="handle sw" />
      <i className="handle se" />
    </>
  );
}
