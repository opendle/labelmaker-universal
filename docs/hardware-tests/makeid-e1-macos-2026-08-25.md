# MakeID E1 macOS hardware test — 2026-08-25

## Test equipment

- Printer: MakeID E1, advertised as `YichipFPGA-1308`.
- Printer firmware: macOS reported Bluetooth firmware `6.4.4`.
- Media: 16 mm continuous label tape.
- Host: macOS 26.6.1, build 25G76.
- Transport: Bluetooth Classic RFCOMM channel 1.

The test report does not contain the Bluetooth device address.

## Results

| Test                          | Result                                         |
| ----------------------------- | ---------------------------------------------- |
| Paired-device discovery       | Pass                                           |
| RFCOMM channel open           | Pass                                           |
| Six-byte status query         | Pass; printer reported `Ready`                 |
| One-copy corner pattern       | Pass; four black corner dots printed           |
| Black-bit polarity            | Pass                                           |
| 96-dot head bit order         | Pass                                           |
| Multi-frame desktop print     | Pass; `RESISTORS` printed without section gaps |
| Initial feed-line direction   | Fail; text printed as a mirror image           |
| Corrected feed-line direction | Pass; text read from left to right             |
| Content and output            | Pass; user reported a perfect print            |
| Zero-margin trimmed job       | Pass; desktop job completed                    |
| Native pairing after forget   | Pass; IOBluetooth pairing completed            |
| Status after native pairing   | Pass; printer reported `Ready`                 |
| Remove and add flow           | Pass; progress shown and dialog closed         |
| Print after remove and add    | Pass; desktop job completed                    |

## Confirmed implementation values

- Frame marker: `0x66`.
- Status command: `0x10`.
- Raster command: `0x1B`.
- RFCOMM channel: `1`.
- Print head: 96 pixels, 12 bytes per line.
- Printable head width: 12 mm. A 16 mm label leaves 2 mm at each edge; a label
  of 12 mm or less uses its full height without label margins.
- Input black bit: `1`.
- Bit order in one head line: most-significant bit first.
- Feed-line order: reverse the editor horizontal pixel order before transfer.
- Raster chunk size: 170 feed lines. A multi-frame label printed without gaps.

## Pairing recovery

After the printer was forgotten in macOS, Bluetooth Settings showed it with a
keyboard icon and did not complete pairing. The device class label was not a
protocol change: a native IOBluetooth inquiry found the same E1, native pairing
completed, and the printer still advertised `SPP slave` on RFCOMM channel 1.
The status probe then returned `Ready`.

The desktop Add Printer flow was checked after this recovery. The saved printer
was removed, discovered again, added with a visible processing state, and used
for a successful desktop print. The app reports a paired printer as `Available`
until a print opens a live protocol session.

## Remaining opt-in checks

- Two copies.
- Cancellation during transfer.
- Open lid, low battery, and empty media states.
- 9 mm and 12 mm media.
- Exact device firmware from the printer application or device information
  screen. The macOS Bluetooth firmware value can be a transport value.
