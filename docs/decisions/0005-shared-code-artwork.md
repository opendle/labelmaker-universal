# Shared QR code and barcode artwork

## Status

Accepted.

## Context

The code editor must retain structured fields in saved workspaces. The editor,
label strip, and printed label must use the same encoded content. A code image
can include a white border when the user selects it.

## Decision

Store code settings in the domain document. Store each QR form as a typed data
object. Build its standard payload in the shared rendering package. Use
`@bwip-js/generic` to encode QR codes and barcodes as SVG. This package works
without Node APIs or a DOM. Use the same SVG artwork in each application shell.

Add no code margin by default. Store the optional white-border setting in the
code element. Keep the complete code frame during automatic trim. Keep the
SVG aspect ratio inside the frame. Do not store generated SVG in the workspace.

## Consequences

A new structured QR type requires a domain type, document validation, a payload
builder, and a form definition. It does not require changes to printer adapters.
Code content is checked by the encoder before insertion. Print errors remain
errors if a saved legacy code has content that the encoder cannot use.
