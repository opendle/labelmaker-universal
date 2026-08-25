# Desktop UI specification

## Character

The product is a focused desktop tool. It must feel calm, tactile, and compact.
Use native desktop conventions, clear hierarchy, modest color, and strong
preview contrast. Avoid landing-page sections, large hero text, analytics cards,
and excessive decoration.

## Window layout

- **Top bar:** workspace name, save state, undo, redo, preview, and print.
- **Left rail:** configured printers, add-printer action, and workspace actions.
- **Center:** one WYSIWYG label canvas with a neutral work surface.
- **Right inspector:** plate size or selected-element properties.
- **Bottom plate strip:** a compact row of ordered plate thumbnails and one
  large `+` plate.

The center canvas keeps priority when the window becomes narrow. Secondary rail
content can collapse, but printer status and the plate strip remain reachable.

## Required mock interactions

- Select a printer and see its state.
- Open an add-printer dialog with mock discovery results.
- Select plate thumbnails.
- Add a plate with the large `+` control.
- Select, move, and edit a text element.
- Change plate width and height.
- Add a text element.
- Add an image element. Text and image are separate actions, and both element
  types can move on the plate.
- Set left and right plate margins, with zero as the default.
- Trim the plate width to the content bounds plus the selected margins.
- Add a flag or cable-wrap plate from the special-label actions.
- Show unsaved state, save state, preview, and a mock print result.

## Visual test sizes

- Primary desktop: 1440 × 960.
- Compact desktop: 1100 × 760.
- No mobile layout is required.

## Accessibility

- All controls need accessible names and keyboard focus.
- Do not use color as the only state signal.
- Keep text and control contrast at WCAG AA.
- Support normal keyboard shortcuts for save, undo, redo, delete, and zoom.
- Respect reduced-motion settings.
