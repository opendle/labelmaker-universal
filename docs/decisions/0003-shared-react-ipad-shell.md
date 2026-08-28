# ADR 0003: Use the shared React application in a native iPad shell

- Status: accepted
- Date: 2026-08-28

## Context

Labelmaker must run on iPadOS with and without a physical keyboard. Electron
does not run on iPadOS. A separate native editor would duplicate document,
editor, rendering, and printer behavior.

## Decision

The iPad application embeds the bundled React application in `WKWebView`. The
desktop and iPad applications use the same `@labelmaker/ui` components and the
same TypeScript domain, document, rendering, printing, and MakeID protocol
packages.

The iPad host implements the `LabelmakerHost` port with a narrow request and
reply bridge. Swift owns iPad document access, recovery storage, and
CoreBluetooth byte transport. Swift does not own the MakeID protocol or label
rendering.

The shared UI uses a platform class for touch target size, safe-area layout,
and compact tablet composition. Common behavior stays in shared components.

## Consequences

- Desktop and iPad builds remain separate signed binaries.
- Most application behavior and tests stay shared.
- The iPad shell has a small native security and lifecycle boundary.
- Hardware-specific Bluetooth behavior stays behind the adapter transport port.
- iPad layout and gesture tests are required in addition to desktop visual
  tests.
