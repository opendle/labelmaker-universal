# Workspace document format

## Rules

- Store one workspace as gzip-compressed UTF-8 YAML.
- Use the `.lbl` extension.
- Include `schemaVersion` and migrate old versions explicitly.
- Store physical positions and sizes in millimeters.
- Keep UI-only state, printer selections, and recent-file data out of the file.
- Generate IDs once and preserve them across saves.
- Preserve plate order.
- Reject invalid values, duplicate IDs, and unknown schema versions before a
  workspace enters the editor.
- Write a validated document to a temporary file and replace the destination
  when the platform supports an atomic replacement.

The desktop shell keeps the current file path in the Electron main process. It
does not add that path to the saved YAML or expose raw file-system access to the
renderer.

## Version 1 shape

```yaml
schemaVersion: 1
id: workspace-id
name: Labels
defaultPlateSize:
  widthMm: 40
  heightMm: 16
plates:
  - id: plate-id
    name: Drawer 1
    mirrorPrint: false
    size:
      widthMm: 40
      heightMm: 16
    margins:
      leftMm: 0
      rightMm: 0
    elements:
      - id: element-id
        kind: text
        xMm: 2
        yMm: 3
        widthMm: 36
        heightMm: 8
        rotationDeg: 0
        text: RESISTORS
        fontFamily: Inter
        fontSizePt: 12
        fontWeight: 600
        fontStyle: normal
        lineHeightPt: 14
        align: center
        verticalAlign: middle
```

The gzip stream is the complete `.lbl` file. After decompression, it contains
one YAML document and a final line break. Both the compressed file and the
decompressed YAML have a 25 MiB size limit.

The TypeScript types can include planned element kinds before the editor exposes
them. The loader must still reject unknown schema versions and invalid values.

Plate margins are part of the saved document. They define the horizontal space
that automatic trim keeps before and after printed elements.

`widthMode` is optional in schema version 1. It can be `auto` or `fixed`.
An omitted value means `auto`. Automatic width follows the printed content and
plate margins. Fixed width keeps `size.widthMm` across content edits. A printer
minimum can add blank paper to the output without changing this saved value.
For a flag plate, `size.widthMm` includes both halves and the separation.

Plate names remain part of schema version 1 for compatibility with old saved
files. The editor does not show plate names in the plate strip.

`mirrorPrint` is optional in schema version 1. When it is `true`, the shell
mirrors the print raster across the label width. The editor and label strip do
not mirror the artwork. An omitted value means `false`.

`fontStyle` can be `normal` or `italic`. It is optional in schema version 1 for
compatibility with older workspace files. An omitted value means `normal`.

`lineHeightPt` is optional in schema version 1. It sets a fixed text line
height in points. An omitted value uses the font size as the automatic line
height.

`verticalAlign` can be `top`, `middle`, or `bottom`. It is optional in schema
version 1 for compatibility with older workspace files. An omitted value means
`middle`.

Rectangle-kind elements can include an optional `shapeType` value of `line`,
`rectangle`, or `circle`. An omitted value means `rectangle` for compatibility
with older workspace files. Circle frames can have different width and height;
the renderer prints them as ellipses.

Image elements can include a `transparentBackground` boolean. An omitted value
means `true`. When it is `true`, exact white image pixels reveal the label and
elements below the image. When it is `false`, white pixels stay opaque.

Image elements include integer `brightness` and `contrast` values from 0
through 255. A value of 128 is neutral. Older schema version 1 files can use
`threshold` instead of `brightness`. The loader converts this old black-level
value to the matching brightness and uses neutral contrast. New files use only
`brightness` and `contrast`.

An image edited in the drawing editor can include `editorSource`. This object
stores the full pre-crop PNG, its pixel dimensions, and the visible pixel
bounds. Label rendering continues to use the cropped `source`. The drawing
editor uses `editorSource` so reopening a saved workspace restores the complete
drawing canvas.

## QR codes and barcodes

Code elements keep their physical frame, `kind`, and `value`. A QR code can
also store `qr: { data, errorCorrection }`. The `data` object is the editable
source. Its `type` is one of these values:

- `text`: `text`.
- `url`: `url`.
- `wifi`: `ssid`, `password`, `security` (`WPA`, `WEP`, or `nopass`), and the
  boolean `hidden`.
- `email`: `address`, `subject`, and `body`.
- `phone`: `number`.
- `sms`: `number` and `message`.
- `contact`: `firstName`, `lastName`, `organization`, `phone`, `email`, `url`,
  and `address`.
- `geo`: numeric `latitude` from -90 to 90 and `longitude` from -180 to 180.

All fields for the selected type are required. Text fields can be empty if
that field is optional in the form. `errorCorrection` is `L`, `M`, `Q`, or `H`.
The editor also writes the encoded text to `value`. When `qr` is present, the
renderer uses `qr.data`. Older QR elements without `qr` use `value` as plain
text and use correction level `M`.

Barcode elements store `format`: `code128`, `code39`, `ean13`, `ean8`, `upca`,
`itf14`, `interleaved2of5`, `datamatrix`, or `pdf417`. An omitted format means
`code128`. The optional `barcode` object stores the boolean `showText`. An
omitted value means `true`. Data Matrix and PDF417 do not show text below the
code. The encoder checks the content and check digits for the selected format.

Code fields have a limit of 4,096 characters. Encoding also has a limit of
4,096 UTF-8 bytes, and the selected code format can have a lower limit. Invalid
content must show an error before insertion. The workspace stores the editable
fields, not a generated bitmap. The shared renderer generates the code for
both the editor and print output. The optional boolean `includeMargin` adds an
opaque white border when it is `true`. An omitted value means `false`. New codes
have no added margin. Trim keeps the complete code frame, including the border
when selected.
