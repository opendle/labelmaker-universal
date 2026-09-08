import type { LabelPlate } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";
import { buildPlateSvg, renderPlateForPrinter } from "./index.js";

const plate: LabelPlate = {
  id: "margins",
  name: "Margins",
  size: { widthMm: 2, heightMm: 10 },
  margins: { leftMm: 0, rightMm: 0 },
  elements: [],
};

describe("printer margin output", () => {
  it.each([
    [10, 0, 0, "center", 10, 110],
    [10, 2, 2, "center", 30, 90],
    [10, 4, 4, "center", 50, 70],
    [10, 0, 4, "center", 10, 70],
    [10, 4, 0, "center", 50, 110],
    [16, 1, 3, "center", 0, 110],
    [16, 4, 4, "center", 20, 100],
    [10, 1, 3, "start", 10, 70],
    [10, 1, 3, "end", 30, 90],
    [10, 8, 8, "center", 90, 90],
    [5, 3.3, 1.7, "center", 68, 68],
    [16, 8.2, 7.8, "center", 62, 62],
    [10, 100, 0, "start", 100, 100],
  ] as const)(
    "prints %s mm media with %s / %s mm margins and %s alignment",
    async (
      heightMm,
      marginTopMm,
      marginBottomMm,
      rasterAlignment,
      first,
      end,
    ) => {
      const page = await renderPlateForPrinter(
        { ...plate, size: { ...plate.size, heightMm } },
        {
          dpi: 254,
          rasterWidthPixels: 120,
          printableWidthMm: 12,
          marginTopMm,
          marginBottomMm,
          rasterAlignment,
        },
        (_svg, widthPixels, heightPixels) => ({
          widthPixels,
          heightPixels,
          // Fill even the margins with opaque black to check the final mask.
          data: Uint8Array.from(
            { length: widthPixels * heightPixels * 4 },
            (_, index) => (index % 4 === 3 ? 255 : 0),
          ),
        }),
      );
      expect(page.widthPixels).toBe(120);
      expect(page.heightPixels).toBe(20);
      for (let row = 0; row < page.heightPixels; row += 1) {
        const blackColumns = Array.from(
          { length: page.widthPixels },
          (_, x) => x,
        ).filter(
          (x) =>
            (page.data[row * page.bytesPerRow + Math.floor(x / 8)]! &
              (0x80 >> (x % 8))) !==
            0,
        );
        expect(blackColumns).toEqual(
          Array.from({ length: end - first }, (_, index) => first + index),
        );
      }
    },
  );

  it.each([203, 300])(
    "rounds each margin to a whole printer pixel at %s DPI",
    async (dpi) => {
      const width = Math.round((12 * dpi) / 25.4);
      const page = await renderPlateForPrinter(
        { ...plate, size: { widthMm: 2, heightMm: 12 } },
        {
          dpi,
          rasterWidthPixels: width,
          printableWidthMm: 12,
          marginTopMm: 0.3,
          marginBottomMm: 0.3,
          rasterAlignment: "center",
        },
        (_svg, widthPixels, heightPixels) => ({
          widthPixels,
          heightPixels,
          data: Uint8Array.from(
            { length: widthPixels * heightPixels * 4 },
            (_, index) => (index % 4 === 3 ? 255 : 0),
          ),
        }),
      );
      const first = Math.round((0.3 * width) / 12);
      const end = Math.round((11.7 * width) / 12);
      for (let x = 0; x < width; x += 1) {
        expect((page.data[Math.floor(x / 8)]! & (0x80 >> (x % 8))) !== 0).toBe(
          x >= first && x < end,
        );
      }
    },
  );

  it("clips artwork at both margins without scaling it to the remaining area", () => {
    const svg = buildPlateSvg(
      { ...plate, mirrorPrint: true },
      20,
      120,
      12,
      2,
      3,
    );
    expect(svg).toContain('preserveAspectRatio="none" viewBox="0 -1 2 12"');
    expect(svg).toContain(
      '<clipPath id="printable-area"><rect x="0" y="2" width="2" height="5"/></clipPath>',
    );
    expect(svg).toContain(
      '<g clip-path="url(#printable-area)"><g transform="translate(2 0) scale(-1 1)">',
    );
  });
});
