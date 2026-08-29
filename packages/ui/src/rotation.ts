export const ROTATION_SNAP_DEGREES = 45;

export function snapRotationDegrees(rotationDeg: number): number {
  const snapped =
    Math.round(rotationDeg / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  return ((snapped % 360) + 360) % 360;
}
