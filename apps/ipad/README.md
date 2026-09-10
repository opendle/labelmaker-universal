# Labelmaker for iPhone and iPad

This target uses a small SwiftUI and `WKWebView` shell around the same React
editor, domain model, document codec, renderer, and MakeID adapter as the
desktop application. Swift owns system document access and the CoreBluetooth byte
transport. The shared TypeScript adapter owns the printer protocol.

## Requirements

See [iPhone Duo readiness](../../docs/iphone-duo.md) for the September 2026
assessment and the remaining native checks. Duo full-display validation needs
Xcode 27.1 and the iOS 27.1 SDK; the deployment minimum stays iOS 17.

- Xcode 26 or later
- iOS or iPadOS 17 or later
- Node.js and npm versions from the repository root `package.json`
- An Apple Development team configured in Xcode for device installation

## Build and run

1. Run `npm install` at the repository root.
2. Open `apps/ipad/Labelmaker.xcodeproj` in Xcode.
3. Select the `Labelmaker` scheme and the connected iPhone or iPad.
4. In Signing & Capabilities, select your development team. Keep automatic
   signing and the `com.opendle.labelmaker` development bundle identifier.
5. Press Run.

After signing and device trust are configured, set `IPHONE_ID` to the connected
iPhone identifier and run this command from the repository root:

```sh
npm run iphone:deploy
```

For an iPad, set `IPAD_ID` to its identifier and run:

```sh
npm run ipad:deploy
```

The command builds the app, installs it on the device, and starts it.

To build and start the app in the default local simulators, run:

```sh
npm run iphone:simulator
npm run ipad:simulator
```

The defaults are `iPhone 17 Pro` and `iPad Pro 13-inch (M5)`. Set
`IPHONE_SIMULATOR` or `IPAD_SIMULATOR` to another available simulator name or
simulator identifier when needed.

For local builds, the Xcode target runs the Apple mobile web build before each
native build. You can also check it separately with:

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

## Xcode Cloud

Use `apps/ipad/Labelmaker.xcodeproj` and the shared `Labelmaker` scheme. Select
Xcode 26 or later and an iOS Archive action in the Cloud workflow.

Xcode Cloud runs `ci_scripts/ci_post_clone.sh` next to the project. This script
installs Node.js 24 with Homebrew, runs `npm ci --include=dev` at the repository
root, and builds the web resources. It skips the Electron binary download.
The dependencies and generated web files must be ready before Xcode starts.

During a Cloud build, the `Build shared web app` phase checks the prepared
`WebApp/index.html`. It does not need the post-clone script's `PATH` to remain
set. If preparation fails, check the `ci_post_clone.sh` log for the failed
command. If the build phase reports that `WebApp` is missing, check that the
workflow used this project's post-clone script.

## App Store screenshots

Run the following command from the repository root:

```sh
npm run app-store:screenshots:mobile
```

The task creates five iPad landscape screenshots at 2752 × 2064 pixels in
`artifacts/app-store/ipad-13-landscape`. This folder is ignored by Git.

To create five iPhone portrait screenshots at 1284 × 2778 pixels, run:

```sh
LABELMAKER_APP_STORE_SCREENSHOT_DEVICE=iphone \
  npm run app-store:screenshot --workspace @labelmaker/ipad
```

To create portrait screenshots at 2064 × 2752 pixels, run:

```sh
LABELMAKER_APP_STORE_SCREENSHOT_ORIENTATION=portrait \
  npm run app-store:screenshot --workspace @labelmaker/ipad
```

Set `LABELMAKER_APP_STORE_SCREENSHOT_DIRECTORY` to use a different output
folder. The capture uses local test data and does not need a printer.

To check seven Phone sizes with WebKit and save one portrait and one landscape
screenshot, run:

```sh
npm run responsive:screenshots
```

Set `LABELMAKER_RESPONSIVE_SCREENSHOT_DIRECTORY` to use a different output
folder.

## iPhone and iPad behavior

- Open and Save use system document pickers and the same gzip YAML `.lbl` format
  as the desktop application.
- A validated security-scoped bookmark keeps the current Files location for
  later Save actions.
- Recovery data is stored in Application Support and flushed when the app goes
  to the background.
- HTML file input uses the system picker for PNG, JPEG, GIF, WebP, and BMP
  image import.
- MakeID discovery and GATT input/output use CoreBluetooth. Raster creation and
  MakeID packet encoding remain in the shared TypeScript packages.
