import { mkdtemp, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { withTemporarySvgFile } from "../src/main/temporary-svg-file.js";

describe("temporary desktop SVG files", () => {
  it("provides a short file URL for an SVG that is too large for a data URL", async () => {
    const parent = await mkdtemp(join(tmpdir(), "labelmaker-raster-test-"));
    const svg = `<svg><!--${"x".repeat(14_000_000)}--></svg>`;
    let temporaryPath = "";

    try {
      await withTemporarySvgFile(
        svg,
        async (filePath) => {
          temporaryPath = filePath;
          await expect(stat(filePath)).resolves.toMatchObject({
            size: Buffer.byteLength(svg),
          });
          expect(pathToFileURL(filePath).href.length).toBeLessThan(1_024);
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
        withTemporarySvgFile(
          "<svg/>",
          (filePath) => {
            temporaryPath = filePath;
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
});
