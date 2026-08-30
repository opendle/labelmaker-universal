# Architecture

## Dependency direction

```text
documents -> domain <- rendering <- printing <- concrete adapters
                ^                        ^
                |                        |
                +---- application ports ---- shared UI
                                      ^
                                      |
                 desktop, Apple mobile, Android, or server shell
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
depends on the domain types and the YAML codec. It does not access the file
system. Desktop and server shells provide gzip compression, storage, and the
active file path outside the saved document.

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

`@labelmaker/ui` owns the shared React interface, editor state, and view
components. It talks to an injected `LabelmakerHost` interface. It does not call
Electron IPC, filesystem APIs, or adapters directly.

### Shells

`apps/desktop` creates the Electron window, provides a safe preload API, stores
documents, registers local adapters, and assembles the UI.

`apps/ipad` is the universal iPhone and iPad shell. It embeds the same local
React application in a restricted `WKWebView`. Its Swift host provides system
document pickers, recovery storage, and native
CoreBluetooth transport operations through a narrow request and reply bridge.
The TypeScript MakeID adapter still owns printer protocol behavior.

`apps/android` is the Android 12 or later shell. It embeds the same local React
application in a restricted Android `WebView`. Its Kotlin host provides the
Storage Access Framework, recovery storage, and Android Bluetooth Low Energy
transport operations through the same versioned request and reply contract.

`apps/mobile-web` is the one local React composition for Apple and Android
mobile shells. It owns no native API. Each native shell packages the same
generated web bundle and supplies only its bridge implementation.

`apps/server` can later expose the same application operations over an
authenticated API. A remote server still needs a local bridge near a Bluetooth
or USB printer.

### Shared rendering

`@labelmaker/rendering` owns plate SVG construction and transport-neutral raster
conversion. A shell injects only the platform rasterizer that converts SVG into
RGBA pixels. This keeps desktop, Apple mobile, and Android print output on the
same tested path.

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
