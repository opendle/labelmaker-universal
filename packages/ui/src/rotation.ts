export const ROTATION_INPUT_STEP_DEGREES = 1;
const ROTATION_SNAP_DEGREES = 45;
const ROTATION_SNAP_TOLERANCE_DEGREES = 3;

export function snapRotationDegrees(rotationDeg: number): number {
  const wrapped = rotationDeg % 360;
  const normalized = wrapped < 0 ? wrapped + 360 : wrapped;
  const nearestSnap =
    Math.round(normalized / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  if (Math.abs(normalized - nearestSnap) <= ROTATION_SNAP_TOLERANCE_DEGREES) {
    return nearestSnap % 360;
  }
  return normalized;
}
