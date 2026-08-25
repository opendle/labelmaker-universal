# Architecture

## Dependency direction

```text
documents -> domain <- rendering <- printing <- concrete adapters
                ^                        ^
                |                        |
                +---- application ports ---- shared UI
                                      ^
                                      |
                             desktop or server shell
```

Dependencies point toward stable contracts. The UI knows application ports,
printer descriptors, and capabilities. It does not know Bluetooth, USB, serial
ports, operating-system APIs, or manufacturer packet formats.

## Layers

### Domain

`@labelmaker/domain` owns the versioned workspace format, plates, elements,
physical units, and identifiers. It has no runtime or platform dependency.

### Documents

`@labelmaker/documents` validates, parses, and serializes workspace files. It
depends only on the domain types and does not access the file system. Desktop
and server shells provide storage and keep the active file path outside the
saved document.

### Printing

`@labelmaker/printing` owns adapter contracts, discovery results, printer
sessions, capabilities, status, raster jobs, and the adapter registry. It does
not render React components or access Electron.

The renderer converts a plate into a transport-neutral one-bit raster page.
Printer adapters receive raster pages and convert them to device commands.

### Adapters

Each adapter is a separate package under `packages/adapters`. An adapter can
support one manufacturer, one protocol family, or a small compatible group. It
must declare capabilities from the connected printer instead of making the UI
guess them.

Transport code belongs inside an adapter or a private transport module used by
that adapter. Native helpers are allowed behind this boundary.

### UI

`@labelmaker/ui` owns the React desktop interface, editor state, and view
components. It talks to an injected `LabelmakerHost` interface. It does not call
Electron IPC, filesystem APIs, or adapters directly.

### Shells

`apps/desktop` creates the Electron window, provides a safe preload API, stores
documents, registers local adapters, and assembles the UI.

`apps/server` can later expose the same application operations over an
authenticated API. A remote server still needs a local bridge near a Bluetooth
or USB printer.

## Composition

Adapters are registered explicitly in a composition root. The first release
does not load arbitrary third-party code at runtime. This keeps packaging,
security, versioning, and support clear while the contract is still changing.

## Electron security

- Enable `contextIsolation`.
- Disable `nodeIntegration` in renderer processes.
- Expose a narrow typed preload API.
- Validate all IPC input in the main process.
- Do not expose raw filesystem, shell, socket, or Bluetooth access to the UI.
- Load local application content in production. Do not navigate the main window
  to arbitrary remote content.

## Error model

Use typed result or error values at process and adapter boundaries. Include a
stable error code, a safe user message, a retry hint, and optional diagnostic
detail. Do not expose secrets, device addresses, or raw packet dumps in normal
UI messages.
