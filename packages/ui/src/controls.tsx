import type { PointerEvent, ReactNode } from "react";

import { resizeCursor, type ResizeCorner } from "./resize-cursor.js";

export function IconButton({
  label,
  children,
  className = "icon-button",
  disabled = false,
  initialFocus = false,
  onClick,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly initialFocus?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={className}
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

export function SelectionHandles({
  elementLabel,
  rotationDeg,
  onResizeStart,
  onRotateStart,
}: {
  readonly elementLabel: "text" | "image" | "shape";
  readonly rotationDeg: number;
  readonly onResizeStart: (
    corner: ResizeCorner,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onRotateStart: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <>
      <span aria-hidden="true" className="rotation-stem" />
      <button
        aria-label={`Rotate ${elementLabel} block`}
        className="handle rotate"
        onPointerDown={onRotateStart}
        type="button"
      />
      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
        <button
          aria-label={`Resize ${elementLabel} block ${corner}`}
          className={`handle ${corner}`}
          key={corner}
          onPointerDown={(event) => onResizeStart(corner, event)}
          style={{ cursor: resizeCursor(corner, rotationDeg) }}
          type="button"
        />
      ))}
    </>
  );
}
