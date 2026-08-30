# Desktop application

This directory is the Electron composition root. It owns the main process, the
secure preload bridge, the application window, and adapter registration. The
React interface belongs in `packages/ui`.

The current shell connects the interface to supported paired MakeID printers on
macOS. It saves the protocol-confirmed model profile in the application data
folder, saves workspace files, and converts selected plates to monochrome
printer rasters before it sends a print job. The physical path is verified on
E1. L1 and P31-family profiles still need the planned hardware tests.

Run the application from the repository root:

```bash
npm run dev
```

On macOS, this command prepares a local development app bundle so that the
Dock, Force Quit window, and process list use the `Labelmaker` name.
The generated bundle stays in the ignored `apps/desktop/.runtime` folder.
Xcode 26 or a newer version must be active because the bundle uses its app icon
compiler.

The normal application does not show mock printers. Set
`LABELMAKER_ENABLE_MOCK_PRINTER=1` only when you need the desktop mock fixture.
The screenshot command sets this variable automatically.

Capture the two supported desktop sizes with:

```bash
npm run ui:screenshot
```

The command builds once and captures all desktop images in one hidden app
session. It reloads a clean editor state between images and does not use the
normal workspace recovery file.

After you pair a supported MakeID printer on macOS, you can run one opt-in
desktop hardware print. The command sets both horizontal margins to zero and
trims the current plate before it prints:

```bash
npm run hardware:print --workspace @labelmaker/desktop -- --confirm-print
```

## Mac App Store package

The Mac App Store package uses Electron's `mas` runtime and the Apple App
Sandbox. The visible product name is `Label Maker`. Internal package
identifiers keep the existing `labelmaker` spelling for compatibility. The
package needs Apple signing resources for team `32J9W47SH8` and bundle ID
`com.opendle.labelmaker`.

Build and test a development package with:

```bash
LABELMAKER_APPLE_TEAM_ID=32J9W47SH8 npm run mas:development
```

Build the distribution `.pkg` with a new build number:

```bash
LABELMAKER_APPLE_TEAM_ID=32J9W47SH8 LABELMAKER_MAS_BUILD=1 npm run mas:distribution
```

Store the App Store Connect API key in the login Keychain once:

```bash
npm run mas:store-api-key -- /path/to/AuthKey_EXAMPLE123.p8 --delete-source
```

Upload a new version after you set the API-key ID and issuer variables:

```bash
LABELMAKER_MAS_VERSION=1.0.1 LABELMAKER_MAS_BUILD=2 npm run mas:upload
```

The upload command builds and signs a fresh package, validates it with Apple,
and uploads it. The development and distribution commands do not upload. See
[`docs/distribution.md`](../../docs/distribution.md) for the certificate,
profile, API-key, output, and manual test requirements.
