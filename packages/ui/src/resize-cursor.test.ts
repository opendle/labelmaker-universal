import { describe, expect, it } from "vitest";

import { resizeCursor } from "./resize-cursor.js";

describe("resizeCursor", () => {
  it.each([
    ["nw", "nesw-resize"],
    ["ne", "nwse-resize"],
    ["sw", "nwse-resize"],
    ["se", "nesw-resize"],
  ] as const)(
    "rotates the %s cursor with a 90-degree element",
    (corner, cursor) => {
      expect(resizeCursor(corner, 90)).toBe(cursor);
    },
  );

  it("uses vertical and horizontal cursors at diagonal rotations", () => {
    expect(resizeCursor("se", 45)).toBe("ns-resize");
    expect(resizeCursor("ne", 45)).toBe("ew-resize");
  });

  it("normalizes negative and complete rotations", () => {
    expect(resizeCursor("se", -90)).toBe("nesw-resize");
    expect(resizeCursor("se", 360)).toBe("nwse-resize");
  });
});
