import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { withTemporarySvgPage } from "../src/main/temporary-svg-file.js";

describe("temporary desktop SVG files", () => {
  it("provides a short file URL for an SVG that is too large for a data URL", async () => {
    const parent = await mkdtemp(join(tmpdir(), "labelmaker-raster-test-"));
    const svg = `<svg><!--${"x".repeat(14_000_000)}--></svg>`;
    let temporaryPath = "";

    try {
      await withTemporarySvgPage(
        svg,
        128,
        96,
        async (pagePath) => {
          temporaryPath = pagePath;
          const svgPath = join(dirname(pagePath), "plate.svg");
          await expect(stat(svgPath)).resolves.toMatchObject({
            size: Buffer.byteLength(svg),
          });
          await expect(readFile(pagePath, "utf8")).resolves.toContain(
            "#plate{display:block;width:128px;height:96px}",
          );
          expect(pathToFileURL(pagePath).href.length).toBeLessThan(1_024);
        },
        parent,
      );

      await expect(stat(temporaryPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("removes the SVG when rasterization fails", async () => {
    const parent = await mkdtemp(join(tmpdir(), "labelmaker-raster-test-"));
    let temporaryPath = "";

    try {
      await expect(
        withTemporarySvgPage(
          "<svg/>",
          1,
          1,
          (pagePath) => {
            temporaryPath = pagePath;
            throw new Error("Rasterizer failed");
          },
          parent,
        ),
      ).rejects.toThrow("Rasterizer failed");
      await expect(stat(temporaryPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("rejects invalid raster dimensions before it creates files", async () => {
    await expect(
      withTemporarySvgPage("<svg/>", 0, 1, () => undefined),
    ).rejects.toThrow("widthPixels must be a positive integer");
  });
});
