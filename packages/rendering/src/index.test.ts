import type { LabelPlate } from "@labelmaker/domain";
import { describe, expect, it, vi } from "vitest";

import {
  MAX_RASTER_BYTES,
  MAX_RASTER_PIXELS,
  createPlateRasterPlan,
  millimetersToPixels,
  packMonochromeRows,
  renderPlateForPrinter,
  renderPlateRgba,
  renderRgbaToRasterPage,
  rgbaToMonochrome,
  validateRasterDimensions,
} from "./index.js";

function rgbaPixel(
  red: number,
  green: number,
  blue: number,
  alpha = 255,
): readonly number[] {
  return [red, green, blue, alpha];
}

describe("physical-size conversion", () => {
  it("converts millimeters with nearest-pixel rounding", () => {
    expect(millimetersToPixels(25.4, 203)).toBe(203);
    expect(millimetersToPixels(12, 203)).toBe(96);
    expect(millimetersToPixels(9, 203)).toBe(72);
    expect(millimetersToPixels(16, 203)).toBe(128);
    expect(millimetersToPixels(0, 203)).toBe(0);
  });

  it("creates a complete rendering plan", () => {
    expect(
      createPlateRasterPlan({
        plateId: "plate-1",
        widthMm: 40,
        heightMm: 12,
        dpi: 203,
      }),
    ).toEqual({
      plateId: "plate-1",
      widthMm: 40,
      heightMm: 12,
      dpi: 203,
      widthPixels: 320,
      heightPixels: 96,
      bytesPerRow: 40,
      byteLength: 3_840,
    });
  });

  it("rejects invalid or unrenderable physical sizes", () => {
    expect(() => millimetersToPixels(-1, 203)).toThrow(/negative/);
    expect(() => millimetersToPixels(1, 0)).toThrow(/greater than zero/);
    expect(() =>
      createPlateRasterPlan({ widthMm: 0.01, heightMm: 12, dpi: 203 }),
    ).toThrow(/positive safe integer/);
  });
});

describe("raster dimension validation", () => {
  it("calculates row padding and rejects unsafe output", () => {
    expect(validateRasterDimensions(9, 2)).toEqual({
      widthPixels: 9,
      heightPixels: 2,
      bytesPerRow: 2,
      byteLength: 4,
    });
    expect(() => validateRasterDimensions(1.5, 2)).toThrow(
      /positive safe integer/,
    );
    expect(() => validateRasterDimensions(MAX_RASTER_BYTES * 8, 2)).toThrow(
      /must not exceed/,
    );
    expect(() => validateRasterDimensions(MAX_RASTER_PIXELS + 1, 1)).toThrow(
      /pixel count must not exceed/,
    );
  });
});

describe("monochrome packing", () => {
  it("packs the first pixel into the most significant bit", () => {
    const page = packMonochromeRows({
      widthPixels: 8,
      heightPixels: 1,
      pixels: Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1]),
    });

    expect(page.bytesPerRow).toBe(1);
    expect([...page.data]).toEqual([0b10110001]);
  });

  it("keeps rows separate and clears unused padding bits", () => {
    const page = packMonochromeRows({
      widthPixels: 10,
      heightPixels: 2,
      pixels: Uint8Array.from([
        1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1,
      ]),
    });

    expect(page.bytesPerRow).toBe(2);
    expect([...page.data]).toEqual([
      0b10000001, 0b10000000, 0b01111110, 0b01000000,
    ]);
  });

  it("rejects a malformed monochrome bitmap", () => {
    expect(() =>
      packMonochromeRows({
        widthPixels: 2,
        heightPixels: 1,
        pixels: Uint8Array.from([0, 2]),
      }),
    ).toThrow(/only 0 or 1/);
  });
});

describe("RGBA conversion", () => {
  it("uses luminance thresholding and composites transparency on white", () => {
    const data = Uint8ClampedArray.from([
      ...rgbaPixel(0, 0, 0),
      ...rgbaPixel(255, 255, 255),
      ...rgbaPixel(0, 0, 0, 0),
      ...rgbaPixel(255, 0, 0),
    ]);

    const bitmap = rgbaToMonochrome(
      { widthPixels: 4, heightPixels: 1, data },
      { threshold: 128 },
    );

    expect([...bitmap.pixels]).toEqual([1, 0, 0, 1]);
    expect([
      ...renderRgbaToRasterPage({ widthPixels: 4, heightPixels: 1, data }).data,
    ]).toEqual([0b10010000]);
  });

  it("keeps a value equal to the threshold white", () => {
    const bitmap = rgbaToMonochrome(
      {
        widthPixels: 1,
        heightPixels: 1,
        data: Uint8Array.from(rgbaPixel(128, 128, 128)),
      },
      { threshold: 128 },
    );

    expect([...bitmap.pixels]).toEqual([0]);
  });

  it("applies deterministic Floyd-Steinberg error diffusion", () => {
    const data = Uint8Array.from([
      ...rgbaPixel(120, 120, 120),
      ...rgbaPixel(120, 120, 120),
    ]);

    expect([
      ...rgbaToMonochrome(
        { widthPixels: 2, heightPixels: 1, data },
        { mode: "threshold", threshold: 128 },
      ).pixels,
    ]).toEqual([1, 1]);
    expect([
      ...rgbaToMonochrome(
        { widthPixels: 2, heightPixels: 1, data },
        { mode: "floyd-steinberg", threshold: 128 },
      ).pixels,
    ]).toEqual([1, 0]);
  });

  it("uses brightness to adjust midtones before dithering", () => {
    const widthPixels = 16;
    const heightPixels = 16;
    const data = Uint8Array.from(
      Array.from({ length: widthPixels * heightPixels }, () =>
        rgbaPixel(128, 128, 128),
      ).flat(),
    );
    const blackPixels = (brightness: number) =>
      [
        ...rgbaToMonochrome(
          { widthPixels, heightPixels, data },
          { brightness, mode: "floyd-steinberg", threshold: 128 },
        ).pixels,
      ].reduce((sum, pixel) => sum + pixel, 0);

    expect(blackPixels(32)).toBeGreaterThan(blackPixels(128));
    expect(blackPixels(128)).toBeGreaterThan(blackPixels(224));
  });

  it("uses contrast to separate image midtones before dithering", () => {
    const widthPixels = 16;
    const heightPixels = 16;
    const data = Uint8Array.from(
      Array.from({ length: widthPixels * heightPixels }, () =>
        rgbaPixel(112, 112, 112),
      ).flat(),
    );
    const blackPixels = (contrast: number) =>
      [
        ...rgbaToMonochrome(
          { widthPixels, heightPixels, data },
          { contrast, mode: "floyd-steinberg", threshold: 128 },
        ).pixels,
      ].reduce((sum, pixel) => sum + pixel, 0);

    expect(blackPixels(32)).toBeLessThan(blackPixels(128));
    expect(blackPixels(128)).toBeLessThan(blackPixels(224));
  });

  it("keeps pure black, pure white, and transparency stable at all tone settings", () => {
    const data = Uint8Array.from([
      ...rgbaPixel(0, 0, 0),
      ...rgbaPixel(255, 255, 255),
      ...rgbaPixel(0, 0, 0, 0),
    ]);

    for (const toneValue of [0, 128, 255]) {
      expect([
        ...rgbaToMonochrome(
          { widthPixels: 3, heightPixels: 1, data },
          {
            brightness: toneValue,
            contrast: toneValue,
            mode: "floyd-steinberg",
            threshold: 128,
          },
        ).pixels,
      ]).toEqual([1, 0, 0]);
    }
  });

  it("validates RGBA input and the requested plate plan", () => {
    expect(() =>
      rgbaToMonochrome({
        widthPixels: 2,
        heightPixels: 1,
        data: Uint8Array.from([0, 0, 0, 255]),
      }),
    ).toThrow(/length must be 8/);
    expect(() =>
      rgbaToMonochrome(
        {
          widthPixels: 1,
          heightPixels: 1,
          data: Uint8Array.from(rgbaPixel(128, 128, 128)),
        },
        { brightness: 256 },
      ),
    ).toThrow(/brightness/);
    expect(() =>
      rgbaToMonochrome(
        {
          widthPixels: 1,
          heightPixels: 1,
          data: Uint8Array.from(rgbaPixel(128, 128, 128)),
        },
        { contrast: -1 },
      ),
    ).toThrow(/contrast/);

    const plan = createPlateRasterPlan({
      widthMm: 25.4,
      heightMm: 25.4,
      dpi: 8,
    });
    expect(() =>
      renderPlateRgba(plan, {
        widthPixels: 7,
        heightPixels: 8,
        data: new Uint8Array(7 * 8 * 4),
      }),
    ).toThrow(/must match the plate plan/);
  });
});

describe("image backgrounds in print output", () => {
  const plate = (transparentBackground: boolean): LabelPlate => ({
    id: "plate",
    name: "Plate",
    size: { widthMm: 2, heightMm: 1 },
    margins: { leftMm: 0, rightMm: 0 },
    elements: [
      {
        id: "image",
        kind: "image",
        xMm: 0,
        yMm: 0,
        widthMm: 2,
        heightMm: 1,
        rotationDeg: 0,
        source: "data:image/png;base64,image",
        fit: "stretch",
        brightness: 128,
        contrast: 128,
        transparentBackground,
      },
    ],
  });

  it("keeps white image pixels transparent in the prepared print image", async () => {
    const rasterize = vi
      .fn()
      .mockResolvedValueOnce({
        widthPixels: 2,
        heightPixels: 1,
        data: Uint8Array.from([
          ...rgbaPixel(0, 0, 0),
          ...rgbaPixel(255, 255, 255),
        ]),
      })
      .mockImplementationOnce((svg: string) => {
        const encoded = /data:image\/bmp;base64,([^&"]+)/.exec(svg)?.[1];
        expect(encoded).toBeDefined();
        const bytes = Buffer.from(encoded!, "base64");
        const pixelOffset = bytes.readUInt32LE(10);
        expect(bytes.readUInt16LE(28)).toBe(32);
        expect([...bytes.subarray(pixelOffset, pixelOffset + 8)]).toEqual([
          0, 0, 0, 255, 255, 255, 255, 0,
        ]);
        return {
          widthPixels: 2,
          heightPixels: 1,
          data: Uint8Array.from([
            ...rgbaPixel(255, 255, 255),
            ...rgbaPixel(255, 255, 255),
          ]),
        };
      });

    await renderPlateForPrinter(
      plate(true),
      { dpi: 25.4, rasterWidthPixels: 1, printableWidthMm: 1 },
      rasterize,
    );

    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it("keeps white image pixels opaque when transparency is disabled", async () => {
    const rasterize = vi
      .fn()
      .mockResolvedValueOnce({
        widthPixels: 2,
        heightPixels: 1,
        data: Uint8Array.from([
          ...rgbaPixel(0, 0, 0),
          ...rgbaPixel(255, 255, 255),
        ]),
      })
      .mockImplementationOnce((svg: string) => {
        const encoded = /data:image\/bmp;base64,([^&"]+)/.exec(svg)?.[1];
        expect(encoded).toBeDefined();
        const bytes = Buffer.from(encoded!, "base64");
        expect(bytes.readUInt16LE(28)).toBe(24);
        return {
          widthPixels: 2,
          heightPixels: 1,
          data: Uint8Array.from([
            ...rgbaPixel(255, 255, 255),
            ...rgbaPixel(255, 255, 255),
          ]),
        };
      });

    await renderPlateForPrinter(
      plate(false),
      { dpi: 25.4, rasterWidthPixels: 1, printableWidthMm: 1 },
      rasterize,
    );
  });
});
