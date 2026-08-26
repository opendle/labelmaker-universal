# Roadmap

## Milestone 0 — foundation

- [x] Repository instructions and project skills.
- [x] Versioned domain model.
- [x] Printer adapter contract and registry.
- [x] Mock adapter.
- [x] Product, UI, format, and architecture specifications.

## Milestone 1 — interactive desktop mock

- [x] Electron window and shared React UI.
- [x] Printer list and mock add-printer flow.
- [x] WYSIWYG canvas with movable text and image elements.
- [x] Multiple plates and large add-plate control.
- [x] Plate size, margins, trim, flag, and cable-wrap controls.
- [x] Save-state feedback, preview, and mock print.
- [x] Automated UI tests and current screenshots.

## Milestone 2 — local documents and renderer

- [x] Validated new, open, save, and save-as flows.
- [x] Undo and redo history.
- [x] Deterministic millimeter-to-pixel raster primitives.
- [x] Image elements.
- [x] Connect the editor renderer to print jobs.
- [ ] Connect the editor renderer to the monochrome preview.
- [ ] Add print-preview raster parity tests.

## Milestone 3 — MakeID E1 proof

- [x] Verify the macOS RFCOMM transport on the physical MakeID E1 printer.
- [x] Replace new macOS configurations with the power-cycle-safe BLE transport.
- [x] Clean-room MakeID protocol candidates, fixtures, and tests.
- [x] Hardware-independent status, cancellation, and retry flow.
- [x] One-label proof on a physical MakeID E1.
- [ ] Linux transport proof for a nearby local bridge.

## Milestone 4 — distributable application

- macOS, Windows, and Linux packages.
- Code signing and notarization where applicable.
- Crash-safe document recovery and recent files.
- Adapter diagnostics and user-safe error reporting.

## Milestone 5 — optional server mode

- Authenticated job API and queue.
- Local print agent for printers that are not attached to the server host.
- Container image for the UI and API.
- QR codes, barcodes, templates, and CSV batch jobs as user needs justify them.
