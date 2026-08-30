# Distribution

## Planned channels

- Publish the source repository for public development.
- Publish signed desktop builds for macOS, Windows, and Linux.
- Publish a separate macOS build through the Mac App Store.
- Publish one universal iPhone and iPad application through the App Store.
- Keep the optional server and local print bridge separate from desktop bundles.

## Open-source release

The project source uses the GNU Affero General Public License v3.0.
Contributions and source releases use the same license.

A public release also needs:

- contribution and security-reporting guides;
- a code of conduct;
- source and binary release automation;
- dependency and third-party notice generation;
- reproducible protocol tests that do not require printer hardware.

Store screenshots are generated from the current application with
`npm run app-store:screenshots`. FFmpeg must be on `PATH`. The command converts
each image to an RGB PNG without an alpha channel and verifies it before
completion. It generates five current images for each of these store groups:

- iPhone 6.5-inch portrait at 1284 by 2778 pixels;
- iPad 13-inch landscape at 2752 by 2064 pixels;
- iPad 13-inch portrait at 2064 by 2752 pixels; and
- macOS at 2880 by 1800 pixels.

The fifth image in each group uses dark mode. The mobile capture CSS removes
number-input controls that iOS and iPadOS do not show. The iPad portrait capture
shows the full-width text inspector above the canvas. The image order is editor,
icon library, add printer, printer settings, and dark-mode flag label.

Run `npm run app-store:previews` to generate one 20-second H.264 MP4 app preview
for iPhone, iPad, and Mac. FFmpeg and FFprobe must be on `PATH`. The command
creates:

- `artifacts/app-store/previews/iphone-6.5-portrait/labelmaker-preview.mp4`
  at 886 by 1920 pixels;
- `artifacts/app-store/previews/ipad-13-portrait/labelmaker-preview.mp4` at
  1200 by 1600 pixels; and
- `artifacts/app-store/previews/macos/labelmaker-preview.mp4` at 1920 by 1080
  pixels.

The encoder limits previews to 30 frames per second and adds a stereo AAC track.
It checks the duration, file size, dimensions, bit rate, profile, level,
progressive scan, frame rate, and audio properties against the App Store preview
specification. Generated screenshots and previews stay under
`artifacts/app-store` and are not committed. Store copy is kept in
`distribution/app-store/metadata` so that the published text can be reviewed.

Do not commit application binaries. Publish signed binaries as App Store builds
or GitHub Release assets. Keep only source, release scripts, and public metadata
in Git.

## Mac App Store build

The Mac App Store build is different from a normal Electron macOS build:

- Use Electron's `mas` runtime and Apple App Sandbox.
- Sign the application with the correct Apple Development or Apple Distribution
  identity for the build purpose.
- Use an explicit App ID, bundle ID, Team ID, and provisioning profile.
- Add only the required sandbox entitlements. This application expects Bluetooth
  device access and user-selected file read/write access.
- Prove MakeID E1 CoreBluetooth access in a sandboxed development build before
  the store package becomes a release target.
- Create the App Store Connect app record before uploading the first build.
- Upload with an Apple-supported tool and use a unique build number.

The account holder must create a Mac App Distribution certificate and a Mac
Installer Distribution certificate. The app also needs a Mac App Store
provisioning profile for its App ID. Keep these items in the login keychain and
the local provisioning-profile directory. Do not copy them into this
repository.

This repository does not yet have the Electron `mas` packaging target. Add and
test that target before an upload. The target must use the Electron `mas`
runtime, the App Sandbox, child-process entitlements, the Mac App Store profile,
and the two distribution identities. Test Bluetooth printing and user-selected
workspace files from the signed sandboxed application before package upload.

Do not store certificates, provisioning profiles, private keys, App Store
Connect API keys, or account identifiers in the repository.

## iPhone and iPad build

The Apple mobile application is a separate native binary. It bundles the shared React
application and TypeScript printer code as local web resources. A Swift shell
provides document access and CoreBluetooth. Use automatic signing for local
device builds. Use an explicit distribution profile for App Store builds.

The development build needs an Apple Development identity, an available iPhone
or iPad in Developer Mode, and Bluetooth and document-use privacy descriptions.

For App Store distribution, open Xcode Settings, select Accounts, select the
correct team, and use Manage Certificates to create an Apple Distribution
certificate. Keep automatic signing enabled for the Labelmaker target. Confirm
that `com.opendle.labelmaker` belongs to the same team and App Store Connect app
record. Select a generic iOS device, archive the Release build, and select App
Store Connect distribution in Organizer. Xcode can create or refresh the App
Store provisioning profile during this process. If Xcode cannot create the
certificate or profile, the account holder must give the signed-in account the
required developer-resource access or create the items in Certificates,
Identifiers & Profiles.

Do not export or commit the distribution private key, certificate, or profile.

## Release blockers

- The Apple Developer membership, Team ID, bundle ID, and signing identities are
  not available in this repository.
- Bluetooth Low Energy has not been tested from an Electron `mas` build.
- Bluetooth Low Energy on iPhone and iPad needs a physical MakeID E1 hardware test.
- A Mac App Store package and its sandboxed Bluetooth path are not ready.
- Store contact information, copyright ownership, age rating, availability,
  and Digital Services Act status need the account holder's confirmation.

## Primary references

- Electron Mac App Store guide:
  https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/
- Apple App Sandbox documentation:
  https://developer.apple.com/documentation/security/app-sandbox
- Apple App Store Connect build upload guide:
  https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- Apple app preview specifications:
  https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications/
