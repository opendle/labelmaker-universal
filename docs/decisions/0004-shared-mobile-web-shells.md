# ADR 0004: Use one web application in separate mobile shells

- Status: accepted
- Date: 2026-08-30

## Context

The Apple application already embeds the shared React editor in a native shell.
Android needs different file, lifecycle, WebView, and Bluetooth APIs. A copied
Android React application would create two mobile implementations and make each
editor change harder to verify.

## Decision

`apps/mobile-web` supplies one generated React application to the Apple and
Android native shells. The bundle contains the shared host composition,
document codec, browser rasterizer, printer orchestration, and TypeScript
MakeID protocol.

Swift and Kotlin implement the same versioned native bridge. Native code owns
only system document access, recovery storage, WebView security, lifecycle,
and raw Bluetooth bytes. It does not own workspace rules, raster generation,
printer model detection, or MakeID packets.

The Android shell uses Kotlin, AndroidX WebKit, and one native Activity. It does
not use Compose or a cross-platform wrapper. Windows and Linux continue to use
the Electron shell and can add their own MakeID transport providers later.

## Consequences

- Apple and Android use the same editor and mobile printer workflow.
- Each platform keeps a small native security and hardware boundary.
- A shared mobile change requires Apple and Android regression checks.
- Android Bluetooth code cannot be reused directly on Windows or Linux, but
  the MakeID transport contract and protocol remain shared.
