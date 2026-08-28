# Labelmaker for iPad

This target uses a small SwiftUI and `WKWebView` shell around the same React
editor, domain model, document codec, renderer, and MakeID adapter as the
desktop application. Swift owns iPad Files access and the CoreBluetooth byte
transport. The shared TypeScript adapter owns the printer protocol.

## Requirements

- Xcode 26 or later
- iPadOS 17 or later
- Node.js and npm versions from the repository root `package.json`
- An Apple Development team configured in Xcode for device installation

## Build and run

1. Run `npm install` at the repository root.
2. Open `apps/ipad/Labelmaker.xcodeproj` in Xcode.
3. Select the `Labelmaker` scheme and the connected iPad.
4. In Signing & Capabilities, select your development team. Keep automatic
   signing and the `com.5en1.labelmaker` development bundle identifier.
5. Press Run.

The Xcode target runs the iPad web build before each native build. You can also
check it separately with:

```sh
npm run typecheck --workspace @labelmaker/ipad
npm run build:web --workspace @labelmaker/ipad
xcodebuild -project apps/ipad/Labelmaker.xcodeproj \
  -scheme Labelmaker \
  -destination 'platform=iOS Simulator,name=iPad (A16)' \
  test CODE_SIGNING_ALLOWED=NO
```

The generated Vite bundle is ignored by Git. Do not commit
`Labelmaker/Resources/WebApp`.

## iPad behavior

- Open and Save use iPad document pickers and the same gzip YAML `.lbl` format
  as the desktop application.
- A validated security-scoped bookmark keeps the current Files location for
  later Save actions.
- Recovery data is stored in Application Support and flushed when the app goes
  to the background.
- HTML file input uses the iPad system picker for PNG, JPEG, GIF, WebP, and BMP
  image import.
- The mock printer remains available without Bluetooth hardware.
- MakeID discovery and GATT input/output use CoreBluetooth. Raster creation and
  MakeID packet encoding remain in the shared TypeScript packages.
