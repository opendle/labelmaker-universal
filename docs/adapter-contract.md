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
offsets. `rasterAlignment` reports whether narrower media starts at the top,
stays in the center, or ends at the bottom of the print head. The renderer and
the printable-area guides use this value. A narrower label that fits under the
head has no non-printable area. A missing capability stays hidden or disabled.
An adapter can expose one set of static offline capabilities when all supported
printers are identical. A multi-model adapter uses `offlineCapabilitiesFor`
after it detects and stores a stable model profile. It must not guess a
resolution for an ambiguous model. Manufacturer-specific settings can use
namespaced advanced options after the common controls are insufficient.

Common numeric settings report a minimum, maximum, step, and default value.
Printer settings are outside the workspace document and belong to one
configured printer. The desktop and iPad shells use the shared
`isPrinterSettings` validator before they store darkness, print-head size,
independent top and bottom margins, and inter-label spacing. Geometry values
use 0.1 mm steps. Inter-label
spacing defaults to 1 mm. The shells convert it to whole pixels at the printer
resolution and add white raster rows after each page except the last page.
This keeps spacing transport-neutral and keeps the raster width unchanged.

## Discovery and identity

Discovery returns transient descriptors. Saved printer configuration uses a
generated application ID plus adapter-owned connection data. Display names and
operating-system device addresses are not stable identity on their own.

A platform MakeID transport reports `bluetooth-low-energy` or
`bluetooth-classic` for each discovered device. Shared code must not infer the
transport from an operating-system device-ID prefix. A transport can preserve
or release an opaque device mapping when its operating system needs a private
stable identifier.

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

The MakeID adapter uses one stable `makeid` adapter ID and stores a resolved
model profile in each configured printer descriptor. E1, L1, and the P31
family can use the `ABF0` service, `ABF1` write characteristic, and `ABF2`
notification characteristic. Some L1 firmware uses the separate `FF00`
service. Bluetooth Classic remains a migration path for old E1 records.

An L1 name does not identify the 203-DPI or 300-DPI version. The adapter must
connect and read the printer response before it stores the DPI. The P31 family
must use the same rule because public evidence contains both 288-DPI and
300-DPI values. For protocol 1.3 or later, the same response gives the raster
alignment. Older E1, L1, and P31 profiles use center alignment. An unresolved
descriptor has no offline DPI and cannot print.
These rules apply to macOS, Apple mobile, Android, and future Windows
transports.
The implementation belongs in `packages/adapters/makeid`; model assumptions
must not enter the shared UI.
