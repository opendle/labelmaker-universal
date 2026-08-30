# Distribution

## Planned channels

- Publish the source repository for public development.
- Publish signed desktop builds for macOS, Windows, and Linux.
- Publish a separate macOS build through the Mac App Store.
- Publish one universal iPhone and iPad application through the App Store.
- Keep the optional server and local print bridge separate from desktop bundles.

## Source-available release

The project source uses the Functional Source License 1.1 with the MIT Future
License. Contributions and source releases use the same license. Each version
becomes available under the MIT License two years after that version is made
available.

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
- `artifacts/app-store/previews/ipad-13-landscape/labelmaker-preview.mp4` at
  1600 by 1200 pixels; and
- `artifacts/app-store/previews/macos/labelmaker-preview.mp4` at 1920 by 1080
  pixels.

The Mac preview moves the pointer between the actual control positions. The
iPhone and iPad previews show a short touch marker at each actual tap position.
Both mobile sequences print the edited label. The iPhone sequence also adds a
discovered printer.

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

The repository has separate development and distribution targets. Both targets
use Electron's `mas` runtime. They make a universal app for Apple silicon and
Intel by default. They put the native Bluetooth helper outside ASAR, sign all
child code with inherited sandbox rights, compile the current Label Maker icon,
remove unused Electron privacy permissions, and verify the bundle,
architectures, entitlements, and signatures.

### Apple resources

Create these resources for team `32J9W47SH8` and the explicit App ID
`com.opendle.labelmaker`:

- an Apple Development certificate with its private key on the build Mac;
- a registered development Mac;
- a Mac App Development profile that includes that Mac;
- an Apple Distribution certificate with its private key;
- a Mac Installer Distribution certificate with its private key; and
- a Mac App Store distribution profile.

The two profiles are different. A Mac App Development profile can run only on
its registered Macs. The Mac App Store profile has no provisioned devices and
is only for store distribution.

Install certificates and their private keys in the login keychain. Install the
profiles in one of these folders:

- `~/Library/Developer/Xcode/UserData/Provisioning Profiles`; or
- `~/Library/MobileDevice/Provisioning Profiles`.

Do not copy a certificate, private key, or profile into the repository.

### Development package and sandbox tests

Run this command from the repository root:

```bash
LABELMAKER_APPLE_TEAM_ID=32J9W47SH8 npm run mas:development
```

The command builds, signs, verifies, and starts a smoke test. The smoke test
checks the MAS runtime, the renderer isolation boundary, and a sandboxed
recovery-file write. The development app has a local-server entitlement only
for the Playwright automation connection. The distribution app does not have
this entitlement. Its output app is under
`release/macos-app-store/development`.

The smoke test disables physical printers. Before release, start the same app
normally and complete these manual tests:

1. Allow Bluetooth when macOS asks.
2. Find a MakeID E1 printer and print one label.
3. Save a workspace in a user-selected folder.
4. Close the workspace, use the app's Open command, change the saved workspace,
   and save it again.

These tests prove the two hardware and file-access paths that automation cannot
fully prove.

### Distribution package

Set the product version and macOS build number in `distribution/version.json`.
Use a new build number for each App Store Connect upload:

```bash
LABELMAKER_APPLE_TEAM_ID=32J9W47SH8 npm run mas:distribution
```

The command creates a signed `.pkg` under
`release/macos-app-store/distribution`. It verifies the application signature,
the App Store signing requirement, and the installer signature. It does not
upload the package. A distribution app is not a local test build. Use the
development package for Bluetooth and file tests.

### App Store Connect upload

Create an App Store Connect API key that can upload builds. Download its `.p8`
file once and keep an encrypted backup in 1Password. Move the downloaded key
into the login Keychain with:

```bash
npm run mas:store-api-key -- /path/to/AuthKey_EXAMPLE123.p8 --delete-source
```

The command verifies the Keychain copy before it removes the source file. Do
not put the key in the repository. Set these environment variables:

```bash
export LABELMAKER_APP_STORE_CONNECT_KEY_ID="EXAMPLE123"
export LABELMAKER_APP_STORE_CONNECT_ISSUER_ID="00000000-0000-0000-0000-000000000000"
```

Check the Keychain item without contacting Apple:

```bash
npm run mas:check-api-key
```

Increase the macOS build number in `distribution/version.json` for each upload:

```bash
npm run mas:upload
```

The upload command gets the key from the login Keychain and sends it to Apple's
tool through a mode-600 file in a short-lived AES-256 encrypted disk image. The
command removes the file and detaches the image after each Apple command. It
then runs the distribution build, validates the `.pkg` with Apple, and uploads
it.
It does not change the price, release method, metadata, or other App Store
Connect settings. Do not run this command until the build is ready for upload.

The scripts select profiles by bundle ID, team, platform, purpose, and expiry.
They select signing identities by certificate Team ID. Use these variables only
when more than one valid item still matches:

- `LABELMAKER_MAS_DEVELOPMENT_IDENTITY`;
- `LABELMAKER_MAS_DEVELOPMENT_PROFILE`;
- `LABELMAKER_MAS_APPLICATION_IDENTITY`;
- `LABELMAKER_MAS_INSTALLER_IDENTITY`; and
- `LABELMAKER_MAS_PROVISIONING_PROFILE`.

`LABELMAKER_MAS_ARCH` can be `arm64`, `x64`, or `universal`. The default is
`universal`. `LABELMAKER_MAS_COPYRIGHT` changes the bundle copyright text.

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

### iOS distribution and upload commands

The iOS package is universal. One build serves both iPhone and iPad. Create and
verify the signed `.ipa` without uploading it. Set the product version and iOS
build number in `distribution/version.json`, then run:

```bash
npm run ios:distribution
```

The command builds the current web application, makes a Release archive with
Xcode automatic signing, exports an App Store `.ipa`, and verifies its bundle
ID, version, build, arm64 code, signature, and distribution profile. Xcode can
refresh the iOS provisioning profile when necessary. It does not change the
Mac profiles.

When the build is ready, increase the iOS build number and use the same Keychain
API key:

```bash
npm run ios:upload
```

The upload command performs the same archive and export steps, validates the
`.ipa` with Apple, and uploads it to App Store Connect. It uses the same
short-lived encrypted disk image for the API key. It does not change the price,
release method, or store metadata. Do not run it until the iPhone and iPad build
is ready for upload.

## Android build and distribution

Android builds use Java 17, Android API 36, and Build Tools 36.0.0. Install the
Android SDK and set `ANDROID_HOME` before you use these commands:

```bash
npm run android:build
npm run android:check
npm run android:connected-check
```

`android:check` runs lint, Kotlin unit tests, and a debug package. It stays
separate from `npm run check`. Thus, desktop work does not need an Android SDK.
`android:connected-check` needs a running emulator or an attached Android
device.

The tracked `distribution/version.json` file is the source for the public
product version and each platform build number. Increase the Android build
number before each upload. Run `npm run release:version:check` after a version
change.

### Signing keys

Use one offline Android application-signing key for Play App Signing and the
direct APK. Use a separate Play upload key for each AAB upload. Keep all key
files, aliases, and passwords outside the repository. The direct APK must use
the same application-signing certificate that Google Play uses for installed
application identity.

Set these values for a Play AAB:

```bash
export LABELMAKER_ANDROID_UPLOAD_KEYSTORE="/secure/path/play-upload.jks"
export LABELMAKER_ANDROID_UPLOAD_KEY_ALIAS="labelmaker-upload"
export LABELMAKER_ANDROID_UPLOAD_KEYSTORE_PASSWORD="..."
export LABELMAKER_ANDROID_UPLOAD_KEY_PASSWORD="..."
npm run android:bundle
```

Set these values for a direct APK:

```bash
export LABELMAKER_ANDROID_APP_KEYSTORE="/secure/path/app-signing.jks"
export LABELMAKER_ANDROID_APP_KEY_ALIAS="labelmaker"
export LABELMAKER_ANDROID_APP_KEYSTORE_PASSWORD="..."
export LABELMAKER_ANDROID_APP_KEY_PASSWORD="..."
npm run android:apk
```

The release commands refuse a dirty worktree and missing signing values. They
put output under `release/android/<version>-<build>/<channel>`. Each run produces one
signed artifact, its SHA-256 file, third-party notices, and a JSON manifest.
The manifest records the source commit, versions, tool versions, web-bundle
hash, and artifact hashes. The output stays outside Git.

The Play command makes one AAB. The direct command makes one universal APK. Do
not put a private key, password, APK, or AAB in Git. Android has no analytics,
remote application code, or direct-APK update service.

Use the Play internal track first. Complete the required closed test before a
staged production release. Use 5%, 25%, and 100% stages, with 48 hours of
observation between stages. Stop the rollout for a blocking crash, an
application-not-responding error, a document problem, or a print regression.

### Android hardware acceptance

Run `npm run android:hardware-smoke` only with the Samsung test phone and a
MakeID E1 ready. The command needs explicit confirmation and records non-secret
device and software versions. Complete the physical acceptance list in
`docs/android.md` before release.

The release statement can say that MakeID E1 is verified only after the real
Samsung test passes. L1 and P31 use the shared adapter logic, but they must stay
listed as not physically verified on Android until each model passes the same
test. Emulator and Play pre-launch results are UI evidence only.

## Release blockers

- Bluetooth Low Energy and user-selected workspace files have not been tested
  from the signed Electron `mas` development build.
- Bluetooth Low Energy on iPhone and iPad needs a physical MakeID E1 hardware test.
- Android MakeID E1 printing needs the recorded Samsung hardware test.
- Signed Android release output needs the two external signing-key sets.
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
