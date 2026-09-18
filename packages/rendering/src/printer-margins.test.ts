import type { LabelPlate } from "@labelmaker/domain";
import { describe, expect, it } from "vitest";
import { buildPlateSvg, renderPlateForPrinter } from "./index.js";

const plate: LabelPlate = {
  id: "geometry",
  name: "Geometry",
  size: { widthMm: 2, heightMm: 10 },
  margins: { leftMm: 0, rightMm: 0 },
  elements: [],
};

const opaqueBlack = (
  _svg: string,
  widthPixels: number,
  heightPixels: number,
) => ({
  widthPixels,
  heightPixels,
  // Black outside the paper checks the final mask after dithering.
  data: Uint8Array.from({ length: widthPixels * heightPixels * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : 0,
  ),
});

describe("paper and printhead output", () => {
  it.each([
    [16, "center", 0, 96],
    [14, "center", 0, 96],
    [12, "center", 0, 96],
    [9, "center", 12, 84],
    [16, "start", 0, 96],
    [16, "end", 0, 96],
    [9, "start", 0, 72],
    [9, "end", 24, 96],
  ] as const)(
    "masks %s mm paper at the %s of a 96-pixel head",
    async (heightMm, rasterAlignment, first, end) => {
      const page = await renderPlateForPrinter(
        { ...plate, size: { ...plate.size, heightMm } },
        {
          dpi: 203,
          rasterWidthPixels: 96,
          printableWidthMm: 12,
          rasterAlignment,
        },
        opaqueBlack,
      );
      expect(page.widthPixels).toBe(96);
      expect(page.heightPixels).toBe(16);
      for (let row = 0; row < page.heightPixels; row++) {
        const columns = Array.from({ length: 96 }, (_, x) => x).filter(
          (x) =>
            (page.data[row * page.bytesPerRow + Math.floor(x / 8)]! &
              (0x80 >> (x % 8))) !==
            0,
        );
        expect(columns).toEqual(
          Array.from({ length: end - first }, (_, i) => first + i),
        );
      }
    },
  );

  it.each([203, 300])(
    "rounds fractional paper edges at %s DPI",
    async (dpi) => {
      const width = Math.round((12 * dpi) / 25.4);
      for (const rasterAlignment of ["start", "center", "end"] as const) {
        const page = await renderPlateForPrinter(
          { ...plate, size: { widthMm: 2, heightMm: 9.3 } },
          {
            dpi,
            rasterWidthPixels: width,
            printableWidthMm: 12,
            rasterAlignment,
          },
          opaqueBlack,
        );
        const offset =
          rasterAlignment === "start"
            ? 0
            : rasterAlignment === "center"
              ? 1.35
              : 2.7;
        const first = Math.round((offset * width) / 12);
        const end = Math.round(((offset + 9.3) * width) / 12);
        expect(page.widthPixels).toBe(width);
        for (let x = 0; x < page.bytesPerRow * 8; x++) {
          expect(
            (page.data[Math.floor(x / 8)]! & (0x80 >> (x % 8))) !== 0,
          ).toBe(x >= first && x < end);
        }
      }
    },
  );

  it.each([
    [16, 2, 12],
    [14, 1, 12],
    [12, 0, 12],
    [9, 0, 9],
  ])(
    "clips %s mm paper without changing artwork scale or mirror position",
    (heightMm, top, printable) => {
      const artwork = {
        ...plate,
        size: { widthMm: 2, heightMm },
        mirrorPrint: true,
        elements: [
          {
            id: "shape",
            kind: "rectangle" as const,
            xMm: 0.2,
            yMm: -3,
            widthMm: 1,
            heightMm: 20,
            rotationDeg: 0,
            strokeWidthMm: 0,
            cornerRadiusMm: 0,
            filled: true,
          },
        ],
      };
      const svg = buildPlateSvg(artwork, 16, 96, 12);
      expect(svg).toContain(`viewBox="0 ${(heightMm - 12) / 2} 2 12"`);
      expect(svg).toContain(
        `<clipPath id="printable-area"><rect x="0" y="${top}" width="2" height="${printable}"/></clipPath>`,
      );
      expect(svg).toContain(
        '<g clip-path="url(#printable-area)"><g transform="translate(2 0) scale(-1 1)">',
      );
      expect(svg).toContain('x="0.2" y="-3" width="1" height="20"');
      expect(artwork.elements[0]?.yMm).toBe(-3);
    },
  );
});
