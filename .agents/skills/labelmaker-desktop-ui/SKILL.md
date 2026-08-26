---
name: labelmaker-desktop-ui
description: Build or revise Labelmaker's Electron and React desktop interface, WYSIWYG editor, plate strip, printer list, dialogs, and visual tests. Do not use for printer protocol implementation.
---

# Labelmaker Desktop UI

Read `docs/product.md`, `docs/ui-spec.md`, and `docs/architecture.md` before UI
changes.

- Make a focused desktop tool, not a website or analytics dashboard.
- Keep the canvas visually dominant. Use compact controls and familiar desktop
  patterns.
- A workspace contains ordered plates. Keep the large add-plate control in the
  plate strip.
- Use an injected host interface. Do not import Electron, Node APIs, Bluetooth,
  or concrete adapters into UI code.
- Use mock printers and mock print results for development and automated tests.
- Keep controls keyboard accessible and preserve visible focus.
- Test the primary and compact desktop sizes in `docs/ui-spec.md`.
- Capture and inspect screenshots after material visual changes.
