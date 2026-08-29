export type ResizeCorner = "nw" | "ne" | "sw" | "se";
type ResizeCursor = "ew-resize" | "nesw-resize" | "ns-resize" | "nwse-resize";

const CORNER_ANGLES: Record<ResizeCorner, number> = {
  nw: -135,
  ne: -45,
  sw: 135,
  se: 45,
};
const RESIZE_CURSORS: readonly ResizeCursor[] = [
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
];

export function resizeCursor(
  corner: ResizeCorner,
  rotationDeg: number,
): ResizeCursor {
  const angle = (((CORNER_ANGLES[corner] + rotationDeg) % 180) + 180) % 180;
  return RESIZE_CURSORS[Math.round(angle / 45) % 4] ?? "nwse-resize";
}
