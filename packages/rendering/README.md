# Rendering

`@labelmaker/rendering` builds plate SVG and converts platform-neutral RGBA
pixels into the canonical one-bit raster pages that printer adapters receive.

The package has no React, Electron, canvas, filesystem, or native dependency. A
browser renderer can draw a plate on a canvas, get its `ImageData`, and pass its
`width`, `height`, and `data` to `renderPlateRgba`.

Desktop, Apple mobile, and Android shells call `renderPlateForPrinter` with the
same label and printer target. Each shell supplies an SVG-to-RGBA function. A
mobile shell can also supply a direct image-frame rasterizer so WebKit does not
need to decode a nested image inside an SVG. Image black-level conversion,
print-head layout, mirroring, raster packing, and feed-line order stay shared.

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
  {
    brightness: 160,
    contrast: 144,
    mode: "floyd-steinberg",
    threshold: 128,
  },
);
```

`createPlateRasterPlan` uses nearest-pixel rounding. The renderer composites
transparent RGBA pixels on white before it applies the optional brightness and
contrast curves. It then thresholds or dithers the pixels. A value of 128 is
neutral for both tone controls. Higher brightness makes midtones lighter.
Higher contrast increases separation around the midpoint. Pure white stays
white. Raster validation also limits total pixels before temporary luminance
buffers are allocated.
