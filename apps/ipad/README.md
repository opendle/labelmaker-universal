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
   signing and the `com.opendle.labelmaker` development bundle identifier.
5. Press Run.

After signing and device trust are configured, set `IPAD_ID` to the connected
iPad identifier and run this command from the repository root:

```sh
npm run ipad:deploy
```

The command builds the app, installs it on the iPad, and starts it.

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

## App Store screenshots

Run the following command from the repository root:

```sh
npm run app-store:screenshots
```

The task creates five landscape screenshots at 2752 × 2064 pixels in
`artifacts/app-store/ipad-13-landscape`. This folder is ignored by Git.

To create portrait screenshots at 2064 × 2752 pixels, run:

```sh
LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION=portrait \
  npm run app-store:screenshots
```

Set `LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY` to use a different output
folder. The capture uses local test data and does not need a printer.

## iPad behavior

- Open and Save use iPad document pickers and the same gzip YAML `.lbl` format
  as the desktop application.
- A validated security-scoped bookmark keeps the current Files location for
  later Save actions.
- Recovery data is stored in Application Support and flushed when the app goes
  to the background.
- HTML file input uses the iPad system picker for PNG, JPEG, GIF, WebP, and BMP
  image import.
- MakeID discovery and GATT input/output use CoreBluetooth. Raster creation and
  MakeID packet encoding remain in the shared TypeScript packages.
