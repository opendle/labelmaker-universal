# MakeID adapter

This package contains the first hardware-independent adapter for MakeID E1
label printers. It converts canonical 96-pixel monochrome raster pages into
MakeID `0x66` frames. It has no Bluetooth, Electron, or operating-system
dependency.

The code is an unverified protocol candidate. Do not describe it as physical
printer support until the hardware test plan below passes.

## Package boundary

`MakeIdE1Adapter` needs an injected `MakeIdTransportProvider`. A future platform
package will use that port to:

- discover Bluetooth Classic devices;
- resolve the Serial Port Profile RFCOMM channel;
- open a byte-stream connection;
- implement bounded reads, complete writes, and close.

The adapter filters discovery to `YichipFPGA-*` and explicit `MakeID E1` names.
It does not claim other MakeID models. `RecordingMakeIdTransport` supports unit
tests and future capture comparison tools without Bluetooth hardware.

## Current E1 model

- 203 DPI and a 96-pixel print head.
- 9, 12, and 16 mm continuous tape entries.
- One-bit, most-significant-bit-first canonical input. Each input row is sent as
  one head line. The bit order and black-bit polarity need a physical check.
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

| Field or behavior      | Candidate value                          | Required check                                      |
| ---------------------- | ---------------------------------------- | --------------------------------------------------- |
| Frame marker           | `0x66`                                   | Confirm on an E1 capture                            |
| Frame length           | 16-bit little-endian, includes all bytes | Confirm malformed-frame behavior                    |
| Checksum               | Negative unsigned sum of prior bytes     | Compare with an E1 capture                          |
| Status/control command | `0x10`                                   | Confirm query and cancellation states               |
| Raster command         | `0x1B`                                   | Confirm on a new blank and patterned job            |
| Raster encoding marker | byte 10 is `0x01`                        | Confirm that it means LZO                           |
| Raster payload         | Literal-only LZO1X stream                | Print blank, solid, and alternating patterns        |
| Media and cut fields   | `0x20` and `0x03`                        | Test all three tape widths and manual cut           |
| Chunk size             | 170 head lines                           | Test short and multi-frame labels                   |
| Response fields        | flags at byte 4, state at byte 35        | Capture ready, busy, paused, and error states       |
| Final control state    | `0x03`                                   | Determine whether it means finish, reset, or cancel |

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
