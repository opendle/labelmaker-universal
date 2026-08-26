# MakeID E1 macOS BLE check — 2026-08-26

## Scope

This check followed the stale Classic Bluetooth bond failure. It used one
MakeID E1 on macOS 26.6.1 on an Apple Silicon Mac. The report does not contain
the Bluetooth address or the CoreBluetooth peripheral ID.

## Root cause

The old macOS transport paired the printer and used Bluetooth Classic RFCOMM.
The printer could lose or reject the Classic bond after a power cycle while
macOS kept the old bond. macOS then showed the printer as connected, but the
RFCOMM serial channel did not open. Removing the printer from macOS removed the
stale bond and made one connection work again.

The MakeID phone application does not require a visible operating-system
pairing. The E1 also advertises as a Bluetooth Low Energy peripheral. This is
the correct behavior for a BLE application connection.

## Live GATT result

A read-only CoreBluetooth scan found the printer under its E1 serial name. The
scan connected and found these values:

| Item                      | Value                          |
| ------------------------- | ------------------------------ |
| Service                   | `ABF0`                         |
| Write characteristic      | `ABF1`, write without response |
| Reply characteristic      | `ABF2`, notify                 |
| Additional characteristic | `ABF3`, read and write         |

The probe enabled `ABF2` notifications and sent only the six-byte status
request `66 06 00 10 00 84` to `ABF1`. The printer returned one valid 44-byte
status frame on `ABF2`. The adapter parsed it as `Ready`. No label was printed
during this probe.

## Implementation result

New macOS discovery uses CoreBluetooth. It saves the app-scoped peripheral UUID
as an opaque `macos-ble-*` ID. A later process retrieves the peripheral by that
UUID. The connection validates `ABF0`, `ABF1`, and `ABF2` before it reports
ready. Writes use the CoreBluetooth maximum write length and its write-without-
response backpressure signal. Notifications remain a raw transport-neutral byte
stream for the TypeScript frame parser.

The old Classic path remains available only for saved `macos-bt-*` IDs. A user
must remove and add an old saved printer one time to create a new BLE
configuration. The user does not have to remove or pair the printer in macOS
Bluetooth Settings.

## Final reliability result

The repository hardware tools and the live desktop app completed these checks:

1. A fresh BLE status probe found `E124H00894` and reported `Ready`.
2. One open BLE session reported `Ready`, stayed open while the printer was
   switched off for five seconds, reconnected after power-on, and reported
   `Ready` again.
3. The adapter sent its fixed 80-line four-corner raster after that power
   cycle. The printer fed one label with the expected corner marks.
4. The desktop app restored the saved BLE printer, used its custom display
   name, rendered a trimmed plate, and printed the physical label correctly.

The printer was not removed from Labelmaker or macOS during these checks. The
new BLE path does not require macOS Bluetooth pairing. The extended media,
copy-count, cancellation, lid-open, low-battery, and empty-media checks remain
open.
