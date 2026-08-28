# Product specification

## Purpose

Labelmaker lets a user design labels and print them on devices from different
manufacturers. It runs on desktop operating systems and iPadOS. The product
must hide printer protocol details behind adapters.

## First-release user flow

1. Open the desktop or iPad application.
2. Select a saved printer or add a printer.
3. Open or create a label workspace.
4. Select one plate in that workspace.
5. Edit the plate on a direct-manipulation canvas.
6. Add another plate with a large `+` control when needed.
7. Save the complete workspace as one file.
8. Preview and print one plate or all plates.

## Main concepts

- **Printer:** A configured physical or mock printer.
- **Adapter:** A manufacturer or protocol integration that discovers and drives
  compatible printers.
- **Workspace:** One saved label document.
- **Plate:** One label inside a workspace. A workspace contains one or more
  plates in a stable order.
- **Element:** Text, an image, a shape, a QR code, or a barcode placed on a plate.

## Initial interface

- The top bar contains workspace actions and a compact printer selector.
- The center contains the WYSIWYG plate canvas.
- A plate strip gives each plate a thumbnail and a large add button.
- A compact inspector contains plate size and selected-element settings.
- Save, preview, and print are always easy to find.
- Empty states teach one action. They do not show large explanations.

## First-release scope

- Printer list, selection, physical printer discovery, and add-printer flow.
- Start with no configured printer. Keep mock printers in test fixtures only.
- Restore the last selected printer on the next launch.
- Restore the complete last editor session on launch, including unsaved work.
  Invalid recovery data must not stop the application from starting.
- Per-printer output settings for print-head size, independent top and bottom
  margins, reported capabilities such as darkness, and a display-only name.
- New, open, save, and save-as workspace actions.
- Multiple plates in one workspace.
- Label width and height settings.
- Text elements with position, size, alignment, weight, and rotation.
- Image import and basic placement.
- Zoomed WYSIWYG canvas and monochrome print preview.
- Capability-driven non-printable area guides.
- Print one plate or all plates through the selected adapter.
- Optional print-only mirroring for each plate.
- Undo and redo for editor changes.

## Later scope

- QR codes, barcodes, reusable templates, variable data, CSV batch printing,
  cloud synchronization, and third-party adapter distribution.
- These items must not make the initial UI or contracts needlessly complex.

## Quality goals

- A new user can create and print a text label without documentation.
- The on-screen preview matches the generated raster within one printer pixel.
- A printer failure cannot corrupt the open workspace.
- Unsupported printer capabilities are disabled or explained before printing.
- A user can complete the first-release flow on an iPad without a physical
  keyboard. A connected keyboard keeps the normal shortcuts.
