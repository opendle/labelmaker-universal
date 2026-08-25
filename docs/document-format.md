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
name: Workshop labels
defaultPlateSize:
  widthMm: 40
  heightMm: 16
plates:
  - id: plate-id
    name: Drawer 1
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
        align: center
```

The gzip stream is the complete `.lbl` file. After decompression, it contains
one YAML document and a final line break. Both the compressed file and the
decompressed YAML have a 25 MiB size limit.

The TypeScript types can include planned element kinds before the editor exposes
them. The loader must still reject unknown schema versions and invalid values.

Plate margins are part of the saved document. They define the horizontal space
that the trim-to-content action keeps before and after printed elements.

`fontStyle` can be `normal` or `italic`. It is optional in schema version 1 for
compatibility with older workspace files. An omitted value means `normal`.
