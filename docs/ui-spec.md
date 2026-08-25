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
- **Editor toolbar:** element actions on the left and always-visible plate name,
  width, height, margins, and trim controls on the right. It spans the center
  and inspector columns.
- **Right inspector:** selected-element properties only. Plate settings do not
  need a separate inspector mode or button.
- **Bottom plate strip:** a compact row of ordered plate thumbnails and one
  large `+` plate.

The center canvas keeps priority when the window becomes narrow. Secondary rail
content can collapse, but printer status and the plate strip remain reachable.

## Required mock interactions

- Select a printer and see its state.
- Open an add-printer dialog with mock discovery results.
- While a printer is added, show progress and disable conflicting dialog
  actions. Close the dialog after success and keep it open after failure.
- Do not show controls that have no action.
- Select plate thumbnails.
- Add a plate with the large `+` control.
- Select, move, and edit a text element.
- Edit text directly on the plate. Double-click an unselected text element, or
  single-click a selected text element, to enter text-edit mode.
- Preserve text line breaks on the canvas and in printed output.
- Resize text elements from corner handles and rotate them from a separate
  rotation handle. Elements can extend outside the plate bounds.
- Apply a typeface, font size, light/regular/semi-bold/bold weight, italic
  style, and alignment to selected text.
- Change plate width and height.
- Add a text element.
- Add an image element. Text and image are separate actions, and both element
  types can move on the plate.
- Set left and right plate margins, with zero as the default.
- Trim the plate width to the rendered text ink bounds plus the selected
  margins. The text element frame must not add blank trim space.
- Add a flag or cable-wrap plate from the special-label actions.
- Keep the two printed sides of a flag identical. Editing either visible side
  updates the other side immediately, or expose only one editable source side.
- Show unsaved state, save state, preview, and a mock print result.
- Before New or Open replaces a changed workspace, offer Save, Discard, and
  Cancel. A canceled or failed save must keep the changed workspace open.

On macOS, use the native window controls from Electron. Do not draw a second
set of traffic-light controls in the application header.

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
