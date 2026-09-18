import assert from "node:assert/strict";
import { renderPlateForPrinter } from "@labelmaker/rendering";

/** Check SVG clipping and final pixels with the browser image renderer. */
export async function assertPaperGeometry(page) {
  const rasterize = async (svg, widthPixels, heightPixels) => {
    const data = await page.evaluate(
      async ({ svg, width, height }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, width, height);
        return Array.from(context.getImageData(0, 0, width, height).data);
      },
      { svg, width: widthPixels, height: heightPixels },
    );
    return { widthPixels, heightPixels, data: Uint8Array.from(data) };
  };
  const shape = {
    id: "shape",
    kind: "rectangle",
    xMm: -1,
    yMm: -20,
    widthMm: 4,
    heightMm: 50,
    rotationDeg: 0,
    filled: true,
    cornerRadiusMm: 0,
    strokeWidthMm: 0,
  };
  const isBlack = (raster, row, column) =>
    Boolean(
      raster.data[row * raster.bytesPerRow + Math.floor(column / 8)] &
      (0x80 >> (column % 8)),
    );
  for (const dpi of [203, 300]) {
    const width = Math.round((12 * dpi) / 25.4);
    for (const heightMm of [16, 14, 12, 9, 9.3]) {
      const plate = {
        id: "paper",
        name: "Paper",
        size: { widthMm: 2, heightMm },
        margins: { leftMm: 0, rightMm: 0 },
        elements: [shape],
      };
      for (const rasterAlignment of ["start", "center", "end"]) {
        const target = {
          dpi,
          rasterWidthPixels: width,
          printableWidthMm: 12,
          rasterAlignment,
        };
        const raster = await renderPlateForPrinter(plate, target, rasterize);
        const offset =
          Math.max(0, 12 - heightMm) *
          (rasterAlignment === "start"
            ? 0
            : rasterAlignment === "center"
              ? 0.5
              : 1);
        const first = Math.round((offset * width) / 12);
        const end = Math.round(
          ((offset + Math.min(heightMm, 12)) * width) / 12,
        );
        assert.equal(raster.widthPixels, width);
        for (let row = 0; row < raster.heightPixels; row++) {
          for (let column = 0; column < width; column++) {
            // Edge antialiasing can change one pixel inside a rounded edge.
            if (column < first || column >= end)
              assert.equal(isBlack(raster, row, column), false);
            else if (column > first && column < end - 1)
              assert.equal(isBlack(raster, row, column), true);
          }
        }
      }
      const target = {
        dpi,
        rasterWidthPixels: width,
        printableWidthMm: 12,
        rasterAlignment: "center",
      };
      const artwork = {
        ...plate,
        elements: [
          {
            ...shape,
            xMm: 0.25,
            widthMm: 0.5,
            yMm: heightMm / 2 - 1.5,
            heightMm: 3,
          },
        ],
      };
      const normal = await renderPlateForPrinter(artwork, target, rasterize);
      const mirrored = await renderPlateForPrinter(
        { ...artwork, mirrorPrint: true },
        target,
        rasterize,
      );
      const blackColumns = new Set();
      for (let row = 0; row < normal.heightPixels; row++) {
        for (let column = 0; column < width; column++) {
          const black = isBlack(normal, row, column);
          assert.equal(
            isBlack(mirrored, normal.heightPixels - row - 1, column),
            black,
          );
          if (black) blackColumns.add(column);
        }
      }
      assert.ok(
        Math.abs(blackColumns.size - (width * 3) / 12) <= 1,
        "Artwork height changed with paper size",
      );
      assert.ok(
        Math.abs(Math.min(...blackColumns) - (width * 4.5) / 12) <= 1,
        "Artwork position changed across the head",
      );
    }
  }
}
