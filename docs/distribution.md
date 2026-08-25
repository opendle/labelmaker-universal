# Distribution

## Planned channels

- Publish the source repository for public development.
- Publish signed desktop builds for macOS, Windows, and Linux.
- Publish a separate macOS build through the Mac App Store.
- Keep the optional server and local print bridge separate from desktop bundles.

## Open-source release

The project source uses Apache-2.0. Contributions and source releases use
the same license.

A public release also needs:

- contribution and security-reporting guides;
- a code of conduct;
- source and binary release automation;
- dependency and third-party notice generation;
- reproducible protocol tests that do not require printer hardware.

## Mac App Store build

The Mac App Store build is different from a normal Electron macOS build:

- Use Electron's `mas` runtime and Apple App Sandbox.
- Sign the application with the correct Apple Development or Apple Distribution
  identity for the build purpose.
- Use an explicit App ID, bundle ID, Team ID, and provisioning profile.
- Add only the required sandbox entitlements. This application expects Bluetooth
  device access and user-selected file read/write access.
- Prove MakeID E1 RFCOMM access in a sandboxed development build before the store
  package becomes a release target.
- Create the App Store Connect app record before uploading the first build.
- Upload with an Apple-supported tool and use a unique build number.

Do not store certificates, provisioning profiles, private keys, App Store
Connect API keys, or account identifiers in the repository.

## Release blockers

- The Apple Developer membership, Team ID, bundle ID, and signing identities are
  not available in this repository.
- Bluetooth Classic RFCOMM has not been tested from an Electron `mas` build.
- The application icon, privacy text, support URL, and store metadata are not
  final.

## Primary references

- Electron Mac App Store guide:
  https://www.electronjs.org/docs/latest/tutorial/mac-app-store-submission-guide/
- Apple App Sandbox documentation:
  https://developer.apple.com/documentation/security/app-sandbox
- Apple App Store Connect build upload guide:
  https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
