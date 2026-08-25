---
name: printer-adapter-development
description: Add or change a printer manufacturer, protocol, discovery path, transport, or adapter test in Labelmaker Universal. Use for physical and mock printer integrations, not for editor-only UI work.
---

# Printer Adapter Development

Read `docs/adapter-contract.md` and `docs/architecture.md` before changes.

- Keep manufacturer and transport behavior in `packages/adapters/<name>`.
- Implement the interfaces from `@labelmaker/printing`; do not add adapter
  conditionals to the UI.
- Accept transport-neutral one-bit raster pages. Do not make an adapter parse a
  workspace or editor element.
- Report discovery, capabilities, status, progress, cancellation, and errors
  through the shared contract.
- Isolate OS and native APIs behind the adapter boundary.
- Add fixed protocol vectors and fake-transport tests before a hardware test.
- Keep hardware tests opt-in and state the exact model and firmware used.
- Update the adapter contract or add an ADR only when the shared boundary must
  change.
