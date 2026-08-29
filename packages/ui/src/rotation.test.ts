import { describe, expect, it } from "vitest";

import { snapRotationDegrees } from "./rotation.js";

describe("snapRotationDegrees", () => {
  it.each([
    [-179, 180],
    [-43, 315],
    [-30, 330],
    [0, 0],
    [2.9, 0],
    [3, 0],
    [3.1, 3.1],
    [41.9, 41.9],
    [42, 45],
    [48, 45],
    [48.1, 48.1],
    [68, 68],
    [87, 90],
    [93, 90],
    [93.1, 93.1],
    [356.9, 356.9],
    [357, 0],
    [359, 0],
    [403, 45],
  ])("snaps %s degrees to %s", (rotationDeg, expected) => {
    expect(snapRotationDegrees(rotationDeg)).toBe(expected);
  });
});
