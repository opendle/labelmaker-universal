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

The paired-device search found one MakeID E1. macOS did not open RFCOMM channel
number 1. The final IOKit result was an I/O timeout. An earlier probe returned a
general IOKit error. The printer did not reach the protocol status query, so no
physical label was printed.

This result can occur when the printer is off, asleep, or connected to another
phone or application. The adapter now reports this recovery action to the user.
It also stops all connection attempts after one 30-second deadline. The final
probe stopped after 28.32 seconds, including the adapter build and device
discovery.

## Required next physical check

1. Turn the printer on and disconnect the MakeID phone application.
2. Run the status probe.
3. Run at least ten sequential fixed-raster prints in one desktop session.
4. Confirm that the output count is ten and that the UI reports ten successes.
5. Power-cycle the printer and print one more label from the saved printer.
