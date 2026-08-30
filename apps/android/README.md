# Label Maker for Android

This application uses a small Kotlin shell and the shared React mobile
application. Kotlin controls Android files, recovery data, WebView security,
system insets, and Bluetooth Low Energy. TypeScript controls the editor,
document validation, raster creation, and MakeID printer protocol.

## Requirements

- Java 17
- Android SDK 36
- Android build tools 36
- Node.js and npm versions from the repository root `package.json`

Set `ANDROID_HOME` to the Android SDK. The Gradle wrapper checks the downloaded
Gradle distribution with its SHA-256 value.

## Local checks

Run these commands from the repository root:

```sh
npm run android:build
npm run android:check
```

The Gradle build first builds `apps/mobile-web`. It then puts the generated web
files in Android build output. Do not put these files in Git.

Use a connected emulator or Android device for the instrumented checks:

```sh
npm run android:connected-check
```

The editor can run without Bluetooth Low Energy hardware. Android asks for the
Nearby Devices permissions only when the user starts printer discovery or a
printer connection.

## Release output

The `play` flavor makes the Play Store AAB. The `direct` flavor makes the
universal APK. Both flavors use `com.opendle.labelmaker` and read their version
from `distribution/version.json`.

Use these environment-variable groups outside the repository:

- `LABELMAKER_ANDROID_UPLOAD_KEYSTORE`
- `LABELMAKER_ANDROID_UPLOAD_KEY_ALIAS`
- `LABELMAKER_ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- `LABELMAKER_ANDROID_UPLOAD_KEY_PASSWORD`
- `LABELMAKER_ANDROID_APP_KEYSTORE`
- `LABELMAKER_ANDROID_APP_KEY_ALIAS`
- `LABELMAKER_ANDROID_APP_KEYSTORE_PASSWORD`
- `LABELMAKER_ANDROID_APP_KEY_PASSWORD`

`verifiedBundlePlayRelease` and `verifiedAssembleDirectRelease` stop with a
clear error if their key group is not complete. Normal assemble tasks can make
unsigned release variants for CI checks.

Do not put keys, passwords, APK files, AAB files, build output, hardware logs,
or device identifiers in Git.
