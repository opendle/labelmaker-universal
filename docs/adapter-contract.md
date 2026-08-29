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
- Serialize all session operations that use one command stream.
- Read or explicitly discard each command reply before the session is reused.
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

The UI must derive available media, dimensions, printable head width, density
controls, color modes, and copy limits from `PrinterCapabilities`. It calculates
non-printable label areas from the label dimension across the print head, the
physical printable head width, and the adapter's default top and bottom head
offsets. A narrower label that fits under the head has no non-printable area. A
missing capability stays hidden or disabled. An adapter can expose static
offline capabilities when the UI must show physical limits without opening a
printer session. Manufacturer-specific settings can use namespaced advanced
options after the common controls are insufficient.

Common numeric settings report a minimum, maximum, step, and default value.
Printer settings are outside the workspace document and belong to one
configured printer. The desktop and iPad shells validate and store darkness,
print-head size, independent top and bottom margins, and inter-label spacing
before they render a print job. Geometry values use 0.1 mm steps. Inter-label
spacing defaults to 1 mm. The shells convert it to whole pixels at the printer
resolution and add white raster rows after each page except the last page.
This keeps spacing transport-neutral and keeps the raster width unchanged.

## Discovery and identity

Discovery returns transient descriptors. Saved printer configuration uses a
generated application ID plus adapter-owned connection data. Display names and
operating-system device addresses are not stable identity on their own.

A configured printer must remain resolvable after an application restart. A
routine print must not depend on a nearby-device inquiry. An adapter can resolve
a saved opaque device ID in its platform transport.

Discovery is paired-only by default. `DiscoveryOptions.includeUnpaired` can
request compatible unpaired devices during an explicit Add Printer search.
Adapters can use operating-system pairing or authorization flows for that
search. Routine configured-printer lists, removal, status, and print resolution
must not scan unpaired devices.

## Test requirements

- Unit-test framing, checksums, raster conversion, chunk boundaries, and error
  parsing with fixed vectors.
- Test discovery filters without physical hardware.
- Provide a record or fake transport for session tests.
- Test two sequential print jobs on one reused session.
- Test a status request that occurs while a print job is active.
- Keep physical-printer smoke tests separate and opt-in.
- Run the adapter contract suite for every adapter.

## MakeID note

The first physical target is MakeID E1. It uses a 96-pixel, 203-DPI head and a
Bluetooth Low Energy print path on macOS. New macOS configurations use the
`ABF0` service, write to `ABF1`, and receive notifications from `ABF2`.
Bluetooth Classic remains a migration path for saved legacy configurations.
The implementation belongs in `packages/adapters/makeid`; E1 assumptions must
not enter the shared UI.
