# MakeID model and protocol research

## Scope

This note records the evidence used for E1, L1, and P31-family support. It is a
clean-room implementation record. Do not add vendor source, a decompiled APK,
device identifiers, or captured vendor print jobs to this repository.

The implementation uses one stable adapter ID, `makeid`. The E1 uses its one
verified fixed profile. The adapter stores an L1 or P31-family resolved profile
only after a safe device query:

| Profile        | DPI | Raster width | Protocol       |   Raster block |
| -------------- | --: | -----------: | -------------- | -------------: |
| `e1-abf0-203`  | 203 |    96 pixels | ABF0 / `0x66`  |       170 rows |
| `l1-abf0-203`  | 203 |    96 pixels | ABF0 / `0x66`  |        85 rows |
| `l1-abf0-300`  | 300 |   144 pixels | ABF0 / `0x66`  |        56 rows |
| `l1-ff00-203`  | 203 |    96 pixels | FF00 / ESC/POS |       one page |
| `l1-ff00-300`  | 300 |   144 pixels | FF00 / ESC/POS |       one page |
| `p31-abf0-288` | 288 |   288 pixels | ABF0 / `0x66`  |        56 rows |
| `p31-abf0-300` | 300 |   304 pixels | ABF0 / `0x66`  | response value |

The old values in this table are fallbacks for protocol versions that do not
report the extended head fields. Protocol 1.3 or later reports the raster bytes
per row and maximum rows per block. The adapter must use those reported values.
A 300-DPI P31-family reply must use protocol 1.3 or later and report 38 bytes,
or 304 pixels, per row. The adapter rejects a pre-1.3 300-DPI reply because it
does not contain enough head-width evidence.

## Official application evidence

Research used the official international MakeID Label Pro Android application:

- Support page: <https://www.makeid.com/global/support>
- Download page: <https://makeid.com/global/download/app/makeid-pro-app.html>
- Version API: <https://intl-b.makeid.com/eo-api/api/version?systemType=1&languageType=3>
- APK URL at the time of research:
  <https://res.intl-b.makeid.com/business/resource/20260828/makeid_label_pro_v1.8.2_release.apk>
- Package: `com.makeid.intl`
- Version: 1.8.2, version code 47
- SHA-256: `307b5e058ca10ab362c8cc387354c4cd5764e8251776cb6cf29d770750ae8b76`

The APK and its extracted files stayed in temporary storage. Only protocol
facts and independently written tests entered this repository.

## ABF0 status and capability query

The safe query is:

```text
66 06 00 10 00 84
```

The reply can have a four-byte `23 23 xx xx` notification wrapper. After the
wrapper is removed, the low three bits of reply byte 6 give the horizontal
DPI: 0 is 203, 1 is 300, 2 is 600, 3 is 180, and 4 is 288. The low nibble of
byte 15 gives an optional vertical DPI: 0 uses the horizontal value, then 1 is
203, 2 is 300, 3 is 600, 4 is 180, and 5 is 288. Bytes 10 through 14 contain
ASCII model data. Bytes 36 and 37 contain the protocol version.

Protocol 1.3 or later adds these fields:

- Byte 38 bits 0 and 1: head alignment.
- Byte 38 bit 2: swap adjacent raster bytes.
- Bytes 39 and 40: little-endian raster bytes per row. Multiply by eight for
  the transport-neutral pixel width.
- Bytes 41 and 42: little-endian maximum raster rows per block.

Protocol 1.6 changes media classification. It does not change DPI detection.

The adapter accepts only E1 at 203 DPI, L1 at 203 or 300 DPI, and P31-family
printers at 288 or 300 DPI. It rejects other replies.

## FF00 L1 evidence

The FF00 path comes from the public MIT-licensed project
[`makeid-labelprinter-l1-bluetooth`](https://github.com/thomashermine/makeid-labelprinter-l1-bluetooth)
at commit `014e91219e0f4598049ccaee1232c46ea09e523e`. This path is separate from
the official APK evidence.

- Service: `FF00`.
- Command notification: `FF01`.
- Write without response: `FF02`.
- Informational notification: `FF03`.
- Model query: `10 FF 20 F0`.
- Open: `10 FF FE 01`, then `10 FF 10 00 02`; expect `OK`.
- Each image starts with another `10 FF FE 01`, then the raster header
  `1D 76 30 00 xL xH yL yH` and MSB-first raster data.
- Close: `10 FF FE 45`; expect `AA`.

The public capture reports `L1-300` and a 144-pixel head. The adapter can use
this path only after it receives a parseable `L1-203` or `L1-300` model reply.
It must not select DPI from the Bluetooth name. The known status reply has no
decoded state fields. The FF00 profile reports `supportsStatus: false`; a
nonempty status reply proves only that the connection responds.

## Discovery and model rules

Discovery accepts only E1, L1, and P31/Q31/GP31 name families. A P31S name is
part of the P31 family. Do not enable D50, EP53, or other application allow-list
models until profile evidence and deterministic tests exist.

L1 discovery creates an unresolved descriptor. The adapter first tries the
ABF0 query and then the FF00 model query. P31 discovery also creates an
unresolved descriptor. It accepts 288 or 300 DPI only from the ABF0 reply.
Marketing text for P31S says 300 DPI, but old protocol evidence says 288 DPI.
The device response is the authority.

## Host implementation rule

TypeScript owns protocol selection, commands, parsing, raster preparation, and
model profiles. A host transport owns only discovery, connection, GATT
characteristics, byte writes, notifications, and close. Keep this division for
macOS and iPadOS, and for future Android and Windows versions. Android can use
the platform BLE GATT API. Windows can use WinRT Bluetooth LE APIs. Neither host
must duplicate DPI or model rules.

## Hardware test plan

The ordered hardware is one L1 300-DPI printer and one P31S. For each printer:

1. Record the exact advertised name, firmware, protocol version, model bytes,
   DPI fields, raster bytes per row, row-block limit, and byte-swap flag.
2. Confirm that the saved profile survives an application restart without a
   new discovery scan.
3. Print blank, corner-dot, alternating-bit, and multi-block test labels.
4. Confirm feed direction, bit order, byte-pair order, black polarity, head
   width, and label alignment.
5. Test darkness minimum, default, and maximum on ABF0 printers.
6. Test one and two copies where the profile reports copy support.
7. Test two sequential jobs, a status request during a job, cancellation, low
   battery, open cover, missing media, power cycle, and reconnect.
8. Redact device identifiers from reports. Do not commit raw vendor jobs.
