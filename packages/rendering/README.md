# Rendering

`@labelmaker/rendering` converts platform-neutral RGBA pixels into the canonical
one-bit raster pages that printer adapters receive.

The package has no React, Electron, canvas, filesystem, or native dependency. A
browser renderer can draw a plate on a canvas, get its `ImageData`, and pass its
`width`, `height`, and `data` to `renderPlateRgba`.

## Canonical raster format

- Rows run from top to bottom.
- Pixels in each row run from left to right.
- The first pixel in a byte uses the most significant bit.
- A set bit is black. A clear bit is white.
- Unused low bits at the end of a row are clear.

This convention is transport-neutral. A printer adapter must convert the bit
order, row order, column order, or polarity when its protocol requires another
format.

## Main API

```ts
const plan = createPlateRasterPlan({
  plateId: "plate-1",
  widthMm: 40,
  heightMm: 12,
  dpi: 203,
});

const page = renderPlateRgba(
  plan,
  {
    widthPixels: canvas.width,
    heightPixels: canvas.height,
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
  },
  { mode: "floyd-steinberg", threshold: 128 },
);
```

`createPlateRasterPlan` uses nearest-pixel rounding. The renderer composites
transparent RGBA pixels on white before thresholding or dithering.
Raster validation also limits total pixels before temporary luminance buffers
are allocated.
