# Desktop and iPad UI specification

## Character

The product is a focused desktop tool. It must feel calm, tactile, and compact.
Use native desktop conventions, clear hierarchy, modest color, and strong
preview contrast. Avoid landing-page sections, large hero text, analytics cards,
and excessive decoration.

## Window layout

- **Top bar:** large New, Open, and Save actions; workspace name and save state;
  undo, redo, preview, a printer menu with an add-printer action, and print.
- **Center:** one WYSIWYG label canvas with a neutral work surface.
- **Editor toolbar:** element actions on the left and always-visible plate name,
  width, height, margins, and trim controls on the right. It spans the center
  and inspector columns.
- **Right inspector:** selected-element properties only. Remove it from the
  layout when no element is selected. Overlay it on the canvas when shown so
  that the canvas keeps its full size and does not move. Plate settings do not
  need a separate inspector mode or button.
- **Bottom plate strip:** a compact row of ordered plate thumbnails, delete
  actions, and one large `+` plate. Use one physical scale for all thumbnails
  and fit each thumbnail control to its label width.

The center canvas keeps priority when the window becomes narrow. Printer status
and the plate strip remain reachable.

The application chrome follows the operating system light or dark appearance.
The label canvas, plate thumbnails, and print previews stay white in both
appearances so that they show the physical label and printed result accurately.

## Required mock interactions

- Select a printer and see its state.
- Select one printer from a compact header menu. Keep printer removal in that
  menu. Put a full-width `+ Add a printer` action at the end of the menu. Restore
  the last selected printer on the next launch. When there is no configured
  printer, replace the menu with a direct `Add printer` action.
- Restore the last editor session on launch. Restore the workspace, unsaved
  state, active label, selected element, zoom, last save time, and saved `.lbl`
  file association. Store recovery state outside the `.lbl` file. If recovery
  data is missing or invalid, start with the default workspace.
- Open an add-printer dialog with physical discovery results. Do not show mock
  or virtual printers in the user interface.
- While a printer is added, show progress and disable conflicting dialog
  actions. Close the dialog after success and keep it open after failure.
- Do not show controls that have no action.
- Select plate thumbnails.
- Delete a plate from its thumbnail. Keep at least one plate in the workspace.
- Add a plate with the large `+` control.
- Select, move, and edit a text element.
- Edit text directly on the plate. Double-click an unselected text element, or
  single-click a selected text element, to enter text-edit mode.
- Preserve text line breaks on the canvas and in printed output.
- Scale text in the canvas, print preview, and plate strip from the same
  physical point size.
- Use the same element frame, horizontal and vertical alignment, line-height,
  and font rules in the canvas, print preview, plate strip, and printed raster.
- Scale the canvas and its elements in one update when the user changes zoom.
- Allow canvas zoom from 60% through 300%.
- Align every 5 mm background grid line to the center of its ruler tick.
- Show capability-reported top and bottom non-printable areas on the canvas and
  in previews. Calculate each area from the current label height and the
  printer's physical printable width. A label that fits inside the printable
  width has no non-printable label area. Do not scale a narrow label to the full
  print-head width.
- Resize text and image elements from corner handles and rotate them from a
  separate rotation handle. Elements can extend outside the plate bounds.
- Show a rotation cursor on the rotation handle.
- Snap moved text and image frames to the absolute label limits and to the
  left, horizontal center, right, top, vertical middle, and bottom of the
  printable area. Snap resized text and image frames to the absolute and
  printable-area limits.
- Apply a typeface, font size, light/regular/semi-bold/bold weight, italic
  style, automatic or fixed line height, and horizontal and vertical alignment
  to selected text.
- Keep font size in whole points. Put its compact input on the same aligned row
  as the wider line-height input.
- Offer twelve useful system typefaces and use Avenir Next, with a Segoe UI
  fallback, for new text.
- Change plate width and height.
- Add a text element.
- Add an image element. Text and image are separate actions, and both element
  types can move and resize on the plate.
- Add line, rectangle, and circle shapes from a menu next to Add image. Let the
  user select, move, resize, and rotate each shape. A resized circle can become
  an ellipse.
- When a label contains more than one user element, show Send to back and Bring
  to front below Rotation in the selected-element inspector.
- Accept only PNG, JPEG, GIF, WebP, and BMP images that the print renderer can
  use.
- Convert imported images to monochrome with Floyd-Steinberg dithering. Show a
  black-level control in the image inspector. Apply it to image midtones before
  dithering, and use the result in previews, trim, and print. A value of 128 is
  neutral, a higher value is darker, and pure white stays white.
- Show width and height above X and Y for text and image frames. Do not show
  separate Position or Size section titles.
- Set left and right plate margins, with zero as the default.
- Adjust the plate width, larger or smaller, to the first and last black
  pixels of the final monochrome raster plus the selected margins. Apply
  elements in document
  order, so a white image can hide earlier content. A fully white image and an
  element frame must not add blank trim space. Round the result up to a whole
  millimeter and divide only the rounding remainder equally between the left
  and right sides.
- Keep the plate width field in whole millimeters.
- Run trim-to-content when the user presses Enter in the plate width, height,
  left margin, or right margin field.
- Align the work-surface dots to the label grid at 1 mm intervals. Fade the
  5 mm grid in all directions over 10 mm outside the label.
- Open printer settings from each configured printer. Keep the current label
  out of this dialog. Show resolution and raster width as fixed capabilities.
  Let the user set a display-only printer name and restore the device name.
  This setting must not change the printer ID or connection data.
  Let the user change print-head size and independent top and bottom margins in
  0.1 mm steps. Let the user change other capabilities that the printer reports
  as adjustable, such as darkness. Store all values for that printer.
- Add a flag or cable-wrap plate from the special-label actions.
- Put a Mirror toggle next to Flag. Mirror the printed output and the main print
  preview. Keep the editor canvas and plate-strip artwork unchanged.
- Keep the two printed sides of a flag identical. Editing either visible side
  updates the other side immediately, or expose only one editable source side.
- In flag mode, the width field controls one half. The complete output width is
  two halves plus the 2 mm separation. Turning flag mode on and off without an
  edit must restore the original label exactly.
- Show unsaved state, save state, preview, and a mock print result.
- Disable all print actions while a print job is active.
- Show the safe printer or render error from a failed print job.
- Do not report a paired printer as live until a status query succeeds.
- Before New or Open replaces a changed workspace, offer Save, Discard, and
  Cancel. A canceled or failed save must keep the changed workspace open.
- Clear text editing and element selection when the user clicks an empty part
  of the label or work surface. Selecting another element replaces the current
  selection.

On macOS, use the native window controls from Electron. Do not draw a second
set of traffic-light controls in the application header.

Cmd+Q must quit on the first command. Save recovery state before exit. Close
printer sessions as best effort, but do not let a transport hold the app open.

## iPad layout and touch input

Use the same React editor and document behavior on desktop and iPad. The iPad
host sets the platform to `ipados`. This value adds an iPad style layer. It does
not add a separate editor.

- Respect the safe area on each edge of the screen.
- Use a right inspector in landscape. At 850 CSS pixels or less, overlay the
  inspector on the lower edge instead of moving or resizing the canvas.
- Keep each main touch target at least 44 CSS pixels wide and high.
- Keep resize and rotation marks small. Give each mark an invisible 44 CSS
  pixel touch area.
- Let one finger move an element. Use two fingers to move the canvas and to
  change the zoom.
- A first tap selects an element. A second tap on selected text starts text
  edit. Keep double-click and keyboard edit behavior for desktop input.
- Show a Delete action when an element is selected. Do not require a hardware
  keyboard to delete an element.
- Keep all keyboard shortcuts when the iPad has a hardware keyboard.
- Use the visual viewport height to detect the on-screen keyboard. Hide the
  plate strip only while that keyboard reduces the available viewport. Focus
  from a physical keyboard must not hide the strip. In a narrow layout, also
  hide the header and inspector during direct text edit with the on-screen
  keyboard so that the label stays visible.
- Support portrait, landscape, Split View, and Stage Manager sizes. Controls
  that do not fit in the editor toolbar can scroll in the horizontal direction.

## Visual test sizes

- Primary desktop: 1440 × 960.
- Compact desktop: 1100 × 760.
- Primary iPad landscape: 1180 × 820 CSS pixels.
- Compact iPad portrait: 768 × 1024 CSS pixels.
- iPad Split View: 744 × 1024 CSS pixels.
- A phone layout is not required.

## Accessibility

- All controls need accessible names and keyboard focus.
- Do not use color as the only state signal.
- Keep text and control contrast at WCAG AA.
- Support normal keyboard shortcuts for save, undo, redo, delete, and zoom.
- Respect reduced-motion settings.
