// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { iconSource } from "./icon-image.js";

describe("iconSource", () => {
  it("renders the selected Lucide icon as a black 512-pixel SVG source", () => {
    const source = iconSource({
      name: "Accessibility",
      label: "Accessibility",
      node: [
        ["circle", { cx: "16", cy: "4", r: "1", key: "head" }],
        ["path", { d: "m18 19 1-7-6 1", key: "body" }],
      ],
    });
    const markup = decodeURIComponent(source.split(",", 2)[1]!);

    expect(source.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(markup).toContain('width="512"');
    expect(markup).toContain('height="512"');
    expect(markup).toContain('stroke="#000000"');
    expect(markup).toContain("<circle");
  });
});
