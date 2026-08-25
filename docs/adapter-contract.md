# Printer adapter contract

## Boundary

An adapter starts with printer discovery and ends with printer-specific bytes.
It receives raster print jobs. It never receives React state, canvas nodes, or a
saved workspace document.

The authoritative TypeScript contract is in `packages/printing/src/index.ts`.

## Adapter responsibilities

- Declare a stable adapter ID, name, manufacturer names, and transport kinds.
- Discover compatible printers without claiming unrelated devices.
- Connect to a selected descriptor and return a session.
- Report current capabilities and printer status.
- Validate raster dimensions and media constraints before transfer.
- Serialize and send print jobs with cancellation and useful progress events.
- Close connections and native resources after use.
- Convert protocol failures to stable application error codes.

## Adapter exclusions

- Do not render labels.
- Do not read or write workspace files.
- Do not show UI.
- Do not import Electron.
- Do not store credentials or device addresses in source control.
- Do not silently reduce or crop a raster that exceeds printer capabilities.

## Capability-driven UI

The UI must derive available media, dimensions, density controls, color modes,
and copy limits from `PrinterCapabilities`. A missing capability stays hidden or
disabled. Manufacturer-specific settings can use namespaced advanced options
after the common controls are insufficient.

## Discovery and identity

Discovery returns transient descriptors. Saved printer configuration uses a
generated application ID plus adapter-owned connection data. Display names and
operating-system device addresses are not stable identity on their own.

## Test requirements

- Unit-test framing, checksums, raster conversion, chunk boundaries, and error
  parsing with fixed vectors.
- Test discovery filters without physical hardware.
- Provide a record or fake transport for session tests.
- Keep physical-printer smoke tests separate and opt-in.
- Run the adapter contract suite for every adapter.

## MakeID note

The first physical target is MakeID E1. It uses a 96-pixel, 203-DPI head and a
Bluetooth Classic RFCOMM print path. Its implementation belongs in
`packages/adapters/makeid`; E1 assumptions must not enter the shared UI.
