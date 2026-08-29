import { describe, expect, it, vi } from "vitest";

import { loadIconCatalog } from "./icon-catalog.js";

describe("loadIconCatalog", () => {
  it("opens the bundled catalog without a network request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const icons = await loadIconCatalog();

    expect(fetch).not.toHaveBeenCalled();
    expect(icons.length).toBeGreaterThan(1_000);
    expect(icons[0]).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        label: expect.any(String),
        node: expect.any(Array),
      }),
    );
  });
});
