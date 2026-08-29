import { describe, expect, it } from "vitest";

import { snapRotationDegrees } from "./rotation.js";

describe("snapRotationDegrees", () => {
  it.each([
    [-179, 180],
    [-30, 315],
    [0, 0],
    [22, 0],
    [23, 45],
    [68, 90],
    [359, 0],
  ])("snaps %s degrees to %s", (rotationDeg, expected) => {
    expect(snapRotationDegrees(rotationDeg)).toBe(expected);
  });
});
