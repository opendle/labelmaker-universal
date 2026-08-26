# MakeID adapter

This package contains the MakeID E1 adapter. It converts canonical 96-pixel
monochrome raster pages into MakeID `0x66` frames. The protocol code has no
operating-system dependency. The macOS transport uses a small helper around
Apple's CoreBluetooth framework. The helper keeps the previous IOBluetooth
Classic path only for saved legacy printer IDs.

The macOS one-label path is verified on 16 mm media in
[`docs/hardware-tests/makeid-e1-macos-2026-08-25.md`](../../../docs/hardware-tests/makeid-e1-macos-2026-08-25.md).
On 2026-08-26, the CoreBluetooth helper discovered the live `E124H00894`,
reconnected by its saved peripheral UUID, enabled notifications, and returned a
ready status. The same session survived a printer power cycle. A fixed-raster
adapter print and a rendered desktop print both completed correctly after that
cycle. The extended hardware matrix below is not complete.

## Package boundary

`MakeIdE1Adapter` needs an injected `MakeIdTransportProvider`. The macOS
provider uses that port to:

- scan for nearby E1 Bluetooth Low Energy advertisements;
- preserve the opaque, app-scoped CoreBluetooth peripheral UUID;
- retrieve a saved peripheral by UUID without a new nearby scan;
- subscribe to the E1 `ABF2` notification characteristic;
- write outgoing protocol bytes to the E1 `ABF1` characteristic;
- keep a legacy Bluetooth Classic connection path for saved `macos-bt-*` IDs;
- implement bounded reads, complete writes, and close.

The session serializes status, print, and close operations on the Bluetooth byte
stream. It consumes the final `0x03` reply before it reuses a session. If that
reply is missing or invalid, it keeps the confirmed print successful and closes
the dirty session. A new operation then uses a new connection.

The native helper reports a BLE printer as
`macos-ble-<lowercase CoreBluetooth UUID>`. The TypeScript provider preserves
this ID without hashing it. On a later launch, the helper resolves the saved
UUID with `retrievePeripheralsWithIdentifiers:`. It writes `READY` only after
the peripheral is connected, the required characteristics are present, and
`ABF2` notifications are active. Standard input and output then form one raw
binary stream. The TypeScript frame reader handles notification fragmentation
and multiple frames in one notification.

After an unexpected disconnect, the helper keeps that stream open, waits for
Bluetooth and the saved peripheral, restores the GATT channel, and sends queued
data only after notifications are active again. A timed-out background status
check does not close this reconnecting helper. The next print checks the same
session before it sends raster data.

Old `macos-bt-<24 hex>` IDs remain valid when the native helper can resolve the
legacy Classic printer. New discovery and configuration use the BLE ID. Both
paths have one bounded connection deadline and one retry.

The adapter filters discovery to `YichipFPGA-*`, explicit `MakeID E1` names,
and the strict E1 serial form such as `E124H00894`. It does not claim other
MakeID models. `RecordingMakeIdTransport` supports unit tests and future
capture comparison tools without Bluetooth hardware.

The provider does not include a Bluetooth address or CoreBluetooth UUID in
normal logs or interface messages.

## macOS hardware checks

The desktop Add Printer search scans for nearby E1 advertisements, including
the serial-name form such as `E124H00894`. Keep the printer powered on and near
the Mac. CoreBluetooth manages the BLE connection; manual Classic pairing is
not required for a new BLE printer.

Then run the status-only probe:

```sh
npm run hardware:probe --workspace @labelmaker/adapter-makeid
```

The power-cycle check keeps one session open. Follow its prompt to switch the
printer off and on, then confirm that the restored session reports ready:

```sh
npm run hardware:power-cycle --workspace @labelmaker/adapter-makeid
```

The probe sends only the six-byte status query. The print check is separate and
opt-in:

```sh
npm run hardware:print --workspace @labelmaker/adapter-makeid
```

The print check sends an 80-feed-pixel label with one black dot at each corner.
It uses the 16 mm media ID, one copy, and darkness 20. Record the observed feed
direction, dot positions, black polarity, tape width, printer model, firmware,
and macOS version before you change protocol constants.

## Current E1 model

- 203 DPI and a 96-pixel, 12 mm printable head width. A 16 mm label has 2 mm
  non-printable areas at the top and bottom. A label of 12 mm or less has no
  non-printable label area and is centered in the 96-pixel raster.
- Adjustable darkness from 0 through 31, with 20 as the default.
- 9, 12, and 16 mm continuous tape entries.
- One-bit, most-significant-bit-first canonical input. Each input row is sent as
  one head line. The 16 mm hardware test confirmed the bit order and black-bit
  polarity.
- Up to nine copies, based on the
  [manufacturer's E1 user manual](https://makeidstore.com/pages/user-manual-download).
  The current frame asks the printer to manage copies. This behavior needs a
  physical check.
- No automatic cut capability is declared.

The adapter rejects any raster which is not exactly 96 pixels wide. The renderer
must pad narrow media to the full head width. The adapter does not silently crop
or resize input.

## Protocol evidence and clean-room rule

MakeID does not publish an E1 protocol specification. The implementation uses
facts checked against the current public
[HelixScreen MakeID integration at commit `af18e52`](https://github.com/prestonbrown/helixscreen/blob/af18e52109ae5ae1687a15eb0daa065b6e2c5a75/src/system/makeid_protocol.cpp)
and the manufacturer's public E1 use documentation. HelixScreen is
GPL-3.0-or-later. No source text, structure, names, or captured packet vector was
copied. This package uses new TypeScript structure and independently generated
test data.

Current reverse-engineering assumptions are:

| Field or behavior      | Candidate value                           | Required check                                      |
| ---------------------- | ----------------------------------------- | --------------------------------------------------- |
| Frame marker           | `0x66`                                    | Confirm on an E1 capture                            |
| Frame length           | 16-bit little-endian, includes all bytes  | Confirm malformed-frame behavior                    |
| Checksum               | Negative unsigned sum of prior bytes      | Compare with an E1 capture                          |
| Status/control command | `0x10`                                    | Confirm query and cancellation states               |
| Raster command         | `0x1B`                                    | Confirm on a new blank and patterned job            |
| Raster encoding marker | byte 10 is `0x01`                         | Confirm that it means LZO                           |
| Raster payload         | Literal-only LZO1X stream                 | Print blank, solid, and alternating patterns        |
| Media and cut fields   | `0x20` and `0x03`                         | Test all three tape widths and manual cut           |
| Chunk size             | 170 head lines                            | Test short and multi-frame labels                   |
| Response fields        | flags at byte 4, state at byte 35         | Capture ready, busy, paused, and error states       |
| Final control state    | `0x03`                                    | Determine whether it means finish, reset, or cancel |
| BLE characteristics    | writes on `ABF1`, notifications on `ABF2` | Confirm on another E1 firmware                      |

## Hardware test plan

1. Capture a small official-app E1 print and redact the Bluetooth device ID.
2. Compare the frame envelope, checksum, status fields, and raster orientation.
3. Use an opt-in command-line transport with a blank label first.
4. Print single-dot corner markers to verify direction, bit order, and polarity.
5. Test 9, 12, and 16 mm tape without changing the shared raster contract.
6. Test one and two copies, cancellation, a disconnected printer, an open lid,
   low battery, and an empty tape path.
7. Record the exact E1 firmware and host operating system in the test report.

Do not add captured vendor jobs to normal unit tests. Use new geometric patterns
whose expected bytes are derived in this repository.
