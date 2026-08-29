# MakeID adapter

This package supports the MakeID E1, L1, and P31 printer families behind one
stable `makeid` adapter ID. TypeScript owns model detection, protocol commands,
raster conversion, and sessions. A platform transport owns only discovery,
connection, byte transfer, notifications, and close.

Do not select L1 or P31S resolution from the Bluetooth name. Discovery stores
an unresolved profile. Connect then gets the resolution and head data from a
safe printer query. This rule must also apply to future Android and Windows
transports.

## Profiles

| Profile        | DPI | Raster width | Protocol       |   Raster block |
| -------------- | --: | -----------: | -------------- | -------------: |
| `e1-abf0-203`  | 203 |    96 pixels | ABF0 / `0x66`  |       170 rows |
| `l1-abf0-203`  | 203 |    96 pixels | ABF0 / `0x66`  |        85 rows |
| `l1-abf0-300`  | 300 |   144 pixels | ABF0 / `0x66`  |        56 rows |
| `l1-ff00-203`  | 203 |    96 pixels | FF00 / ESC/POS |       one page |
| `l1-ff00-300`  | 300 |   144 pixels | FF00 / ESC/POS |       one page |
| `p31-abf0-288` | 288 |   288 pixels | ABF0 / `0x66`  |        56 rows |
| `p31-abf0-300` | 300 |   304 pixels | ABF0 / `0x66`  | response value |

The 304-pixel P31-family value is 38 complete raster bytes from the protocol
1.3 response. It includes byte-alignment padding around the nominal width. The
adapter rejects a 300-DPI P31-family reply that does not report its width. It
does not use the P31S marketing resolution as protocol evidence.

Discovery accepts E1 names, L1 names, and P31, P31S, Q31, or GP31 prefixes. It
does not accept other models from the official application list without a
known profile and fixed tests.

## ABF0 protocol

The safe status and capability query is `66 06 00 10 00 84`. The adapter reads
the DPI fields and the ASCII model field. Protocol 1.3 and later also report:

- the adjacent-raster-byte swap flag;
- raster bytes per row;
- maximum raster rows per block.

The parser accepts only the model, DPI, width, and row-limit combinations in
the table. It rejects a row limit that can create a `0x66` frame larger than
the 16-bit frame length. A notification can have a `23 23 xx xx` wrapper.

ABF0 profiles have darkness from 0 through 31 and up to nine copies. The
adapter transforms the transport-neutral, most-significant-bit-first raster
to the reported byte order before it builds `0x66` frames.

## FF00 L1 protocol

An unresolved L1 tries ABF0 first. It tries FF00 only after ABF0 fails. The
FF00 path is accepted only when model query `10 FF 20 F0` returns a parseable
`L1-203` or `L1-300` value.

The public L1-300 capture has this print order:

1. Query model, firmware, serial number, status, and battery.
2. Send session open `10 FF FE 01` and mode `10 FF 10 00 02`.
3. Wait for `OK`.
4. For each image, send `10 FF FE 01`, the `GS v 0` raster header, and the
   most-significant-bit-first raster.
5. Send `10 FF FE 45` and wait for `AA`.

The image-level `10 FF FE 01` is an observed raster lead-in. It is separate
from the session open. FF00 writes use 100-byte chunks and a 15 ms interval.
No cancel command is known, so cancellation closes the connection. FF00 copy
count is limited to one. The status reply format is not decoded, so the
adapter reports `supportsStatus: false`. A bounded nonempty reply proves only
that the connection is responsive. The session-level `OK` proves print-time
readiness.

## macOS transport

`MacOsMakeIdTransportProvider` runs a small native helper. For Bluetooth Low
Energy it selects these endpoints from the requested protocol family:

| Protocol | Service | Write  | Command notify |
| -------- | ------- | ------ | -------------- |
| ABF0     | `ABF0`  | `ABF1` | `ABF2`         |
| FF00     | `FF00`  | `FF02` | `FF01`         |

The helper writes without response when the characteristic supports it. The
TypeScript transport separates complete `0x66` frames for ABF0. It returns raw
bounded reply bytes for FF00. Saved CoreBluetooth IDs use
`macos-ble-<uuid>`. Saved legacy Classic IDs use `macos-bt-<24 hex>`.

The E1 path is verified on macOS and 16 mm media. See
[`docs/hardware-tests/makeid-e1-macos-2026-08-25.md`](../../../docs/hardware-tests/makeid-e1-macos-2026-08-25.md).
L1 and P31-family support currently uses deterministic tests and needs the
hardware checks below.

The verified E1 profile has a 96-pixel, 203-DPI head. A 16 mm label has 2 mm
default top and bottom head margins. It supports 9, 12, and 16 mm continuous
tape, darkness from 0 through 31, and no automatic cut. The adapter rejects a
raster that is not exactly 96 pixels wide. The renderer must pad narrow media;
the adapter does not crop or resize it.

The ABF0 session serializes status, print, and close operations. It consumes
the final control reply before it reuses the byte stream. If that reply is
missing after a confirmed print, the print stays successful and the adapter
closes the dirty session. The macOS helper can restore the saved CoreBluetooth
peripheral after a power cycle. See the
[`2026-08-26 BLE report`](../../../docs/hardware-tests/makeid-e1-macos-2026-08-26-ble.md)
and the
[`2026-08-26 reliability report`](../../../docs/hardware-tests/makeid-e1-macos-2026-08-26-reliability.md).

## Evidence and clean-room rule

The ABF0 profile work uses facts from MakeID Label Pro 1.8.2, package
`com.makeid.intl`, version code 47. The APK SHA-256 is
`307b5e058ca10ab362c8cc387354c4cd5764e8251776cb6cf29d770750ae8b76`.
The APK and its extracted files stay outside this repository. Do not add vendor
source, decompiled files, device identifiers, or captured vendor print jobs.

The FF00 facts come from the MIT-licensed public project
[`makeid-labelprinter-l1-bluetooth`](https://github.com/thomashermine/makeid-labelprinter-l1-bluetooth)
at commit `014e91219e0f4598049ccaee1232c46ea09e523e`. The implementation has new
TypeScript structure and independently generated vectors. The existing E1
`0x66` framing uses facts from the GPL-3.0-or-later
[`HelixScreen` MakeID integration](https://github.com/prestonbrown/helixscreen/blob/af18e52109ae5ae1687a15eb0daa065b6e2c5a75/src/system/makeid_protocol.cpp)
at commit `af18e52`. No source text, structure, names, or captured packet vector
was copied. See
[`docs/protocol-research/makeid-models.md`](../../../docs/protocol-research/makeid-models.md)
for URLs and field details.

## Host implementation rule

Android can implement `MakeIdTransportProvider` with the platform BLE GATT
API. Windows can implement it with WinRT Bluetooth LE APIs. Both transports
must receive `abf0-66` or `ff00-escpos` from the adapter. They must not parse
model names, select DPI, swap raster bytes, or build print commands. This keeps
the behavior equal on macOS, iPadOS, Android, and Windows.

## Hardware test plan

For the ordered L1 300-DPI printer and P31S:

1. Record the advertised name, firmware, protocol version, model bytes, DPI
   fields, raster bytes per row, row limit, and byte-swap flag.
2. Confirm that the resolved profile works after an application restart.
3. Print blank, corner-dot, alternating-bit, and multi-block labels.
4. Confirm feed direction, bit order, byte-pair order, black polarity, head
   width, and alignment.
5. Test minimum, default, and maximum darkness for ABF0.
6. Test copy limits, two sequential jobs, status during a job, cancellation,
   open cover, missing media, power cycle, and reconnect.
7. Redact device identifiers from the report. Do not commit raw vendor jobs.

The existing E1 opt-in commands remain available:

```sh
npm run hardware:probe --workspace @labelmaker/adapter-makeid
npm run hardware:power-cycle --workspace @labelmaker/adapter-makeid
npm run hardware:print --workspace @labelmaker/adapter-makeid
```
