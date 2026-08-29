// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { iconSource } from "./icon-image.js";

describe("iconSource", () => {
  it("renders the selected Lucide icon as a black 96-pixel SVG source", () => {
    const source = iconSource("Accessibility");
    const markup = decodeURIComponent(source.split(",", 2)[1]!);

    expect(source.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(markup).toContain('width="96"');
    expect(markup).toContain('height="96"');
    expect(markup).toContain('stroke="#000000"');
    expect(markup).toContain("<circle");
  });
});
