# Android application specification

## Supported system

The Android application supports Android 12 or later. It uses application ID
`com.opendle.labelmaker`, minimum API 31, compile API 36, and target API 36.
One application supports phones, tablets, portrait, landscape, multi-window,
touch, a supported pen, and a connected keyboard.

## Application boundary

The Kotlin application contains one Activity and one restricted WebView. It
packages the generated `apps/mobile-web` output. It must not load remote
application code. The Kotlin host owns system files, app recovery, lifecycle,
and raw Bluetooth Low Energy operations. Shared TypeScript owns all editor,
document, raster, printer, and MakeID protocol behavior.

## WebView security

- Load only `https://appassets.androidplatform.net/assets/webapp/index.html`
  through `WebViewAssetLoader`.
- Use an origin-limited AndroidX WebKit message listener. Do not use
  `addJavascriptInterface`.
- Disable file access, uncontrolled content access, clear-text traffic, mixed
  content, multiple windows, and external navigation.
- Do not request the Internet permission.
- Enable WebView inspection only in debug builds.
- Apply the bundled content security policy. Permit local scripts and styles,
  and local, `blob:`, or `data:` images only.

## Documents and recovery

Open uses `ACTION_OPEN_DOCUMENT`. Save As uses `ACTION_CREATE_DOCUMENT`. A
selected file is not associated with the workspace until shared TypeScript has
decoded and validated it. Normal Save uses the persisted content URI. A lost
grant must keep recovery data and return a safe failure.

Workspace input is limited to 25 MiB and must have a gzip header. Recovery is
valid JSON of at most 25 MiB. Store it in `noBackupFilesDir` with an atomic
write. Flush pending recovery when the application leaves the foreground.
Android image input is limited to 8 MiB. Transfer it to the WebView in bounded
parts and decode each part before the next part arrives.

## Native bridge

Bridge version 1 provides host information, workspace confirmation and file
operations, recovery operations, and Bluetooth discover, connect, write, read,
close, cancel, preserve, and release operations. Cancel closes active native
Bluetooth work so a shared print cancellation does not wait for an I/O timeout.
Each request and reply uses the same bounded request ID. Reject unknown methods,
invalid values, excess sizes, and wrong protocol families.

Android bridge messages use parts of at most 128 KiB. A reconstructed message
is limited to 40 MiB and expires after 60 seconds. Remove incomplete data after
completion, timeout, WebView reload, or destruction.

## Bluetooth

Request `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` only when printer work needs
them. The editor remains available without Bluetooth Low Energy hardware.

The native transport supplies raw byte input and output for ABF0/ABF1/ABF2 or
FF00/FF02/FF01. It serializes Android GATT operations, supports the default
23-byte MTU, splits writes, buffers at most 1 MiB of unread notifications, uses
timeouts, ignores late callbacks, and always closes `BluetoothGatt`.

The native device store maps an opaque `android-ble-` identifier to the system
Bluetooth address. Preserve the mapping only for a configured printer. A
routine saved-printer connection must not start a nearby-device scan.

## Release evidence

Android MakeID E1 support needs a physical test on the recorded Samsung phone.
Record the phone model, Android and One UI versions, security patch, WebView
version, printer model and firmware, tape, application version, and build
number. L1 and P31-family code remains available without an Android physical
hardware claim until those models complete the same test.

Record these physical acceptance cases before release:

1. Clean install and upgrade install.
2. Nearby-device permission allow, deny, and later allow.
3. Bluetooth off, error display, Bluetooth on, and recovery.
4. E1 discovery, Add Printer, app restart, and direct saved-device reconnect.
5. One plate, all plates, ten sequential jobs, and print cancellation.
6. Printer power loss during connection and during printing.
7. Printer power cycle and saved-device reconnect.
8. App background and foreground, device lock and unlock, and rotation.
9. Workspace Open, Save, Save As, and recovery after forced process removal.
10. Blank, corner, alternating-bit, and multi-block deterministic rasters.

Record the result outside Git under `artifacts/android-hardware`. Do not record
the Bluetooth address, packet data, a signing key, or a device serial number.

## Automated acceptance

Kotlin tests cover message framing, reconstruction budgets, expiry, recovery,
one lost document-grant case, image import, Bluetooth permission denial and a
later grant, endpoint selection, GATT callback policy, and MTU chunking.

Android instrumented tests cover local startup and a host-information bridge
round trip, external-navigation rejection, safe-area publication after reload,
dark mode, bridge reload cleanup, image import, recovery, and one lost document
grant. An optional supervised test covers MakeID E1 discovery, configuration,
and one print.

The shared browser suite checks the Android layouts at widths of 320, 393, 600,
and 840 px and in short landscape mode. It also checks simulated software-
keyboard states. Add deterministic native GATT operation, queue, timeout,
disconnect, and repeated-close tests. Add Android instrumented tests for Back,
rotation, resize, successful Open, Save, and Save As operations, keyboard
layout, and fake-printer work before these cases become release claims.

Continuous integration has separate jobs for shared Node and Electron gates,
Android lint, unit tests and packaging, an API 31 phone emulator, an API 36
tablet emulator, and Apple mobile simulator tests. A real printer is still
required for Bluetooth evidence.
