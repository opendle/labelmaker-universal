# MakeID E1 macOS reliability check — 2026-08-26

## Scope

This check followed a complete print-path audit. It used the paired MakeID E1
that macOS advertised as `YichipFPGA-1308`. The report does not contain the
Bluetooth device address.

## Deterministic results

- Two sequential print jobs used one fake session and kept all replies in the
  correct order.
- A status request during a print waited until the print operation was
  complete.
- A missing or invalid final control reply closed the dirty session.
- A saved opaque printer ID connected without TypeScript discovery.
- Stream noise, invalid frame lengths, split frames, and combined frames did
  not corrupt the next valid reply.
- One hundred concurrent configuration writes completed. The last requested
  configuration was valid.

## Physical status probe

The paired-device search found one MakeID E1. Its cached Serial Port Profile
record used UUID `0x1101` and RFCOMM channel 1. macOS did not open that channel.
`openRFCOMMChannelSync` returned after approximately 5.5 seconds with a non-null
channel object, `isOpen` set to false, and `kIOReturnError` (`0xe00002bc`, signed
decimal `-536870212`). This code is a general IOKit error. It does not mean that
another process has exclusive access.

The macOS Bluetooth log reported an open timeout, error 706, no channel, and a
duplicate serial-port connection request. A fresh SDP query started but did not
complete in 12 seconds. Fast retries caused overlapping work in `bluetoothd`.
The printer did not reach the protocol status query, so no physical label was
printed.

macOS also provided `/dev/cu.YichipFPGA-1308` through
`IOUserBluetoothSerialDriver`. Opening this device created a Bluetooth baseband
connection, but repeated six-byte status queries got no protocol reply. The
serial device is not a working fallback for this printer state.

This result can occur when the printer is off, asleep, connected to another
host, or when the Mac and printer have different stored bond keys. macOS can
still show the printer as paired or connected when its bond is stale. The
public IOBluetooth API has no supported operation to forget that bond. The app
must not change macOS pairing state without a user action.

The helper now uses only the Serial Port Profile record, keeps SDP and RFCOMM
open in one process, waits for a late channel open, clears failed delegates,
and allows Bluetooth service teardown before a retry. The adapter stops all
connection attempts after one 30-second deadline. It does not start a partial
third attempt near that deadline. The final probe still did not reach `READY`
within the deadline.

## Required next physical check

1. Forget the E1 in macOS Bluetooth Settings.
2. Turn the E1 off and on.
3. Add it in Labelmaker so that the native helper creates a new bond.
4. Run the status probe.
5. Run at least ten sequential fixed-raster prints in one desktop session.
6. Confirm that the output count is ten and that the UI reports ten successes.
7. Power-cycle the printer and print one more label from the saved printer.
