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
`npm run app-store:screenshots`. The generated files stay under
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

Do not store certificates, provisioning profiles, private keys, App Store
Connect API keys, or account identifiers in the repository.

## iPhone and iPad build

The Apple mobile application is a separate native binary. It bundles the shared React
application and TypeScript printer code as local web resources. A Swift shell
provides document access and CoreBluetooth. Use automatic signing for local
device builds. Use an explicit distribution profile for App Store builds.

The development build needs an Apple Development identity, an available iPhone or iPad
in Developer Mode, and Bluetooth and document-use privacy descriptions. Keep
the development Team ID outside the committed project configuration when
possible.

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
