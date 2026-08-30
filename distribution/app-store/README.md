# App Store release assets

Run this command from the repository root:

```sh
npm run app-store:screenshots
```

The task builds the current source and creates five screenshots for each store
surface:

- `artifacts/app-store/iphone-6.5-portrait`: 1284 × 2778 pixels
- `artifacts/app-store/ipad-13-landscape`: 2752 × 2064 pixels
- `artifacts/app-store/macos`: 1440 × 900 or 2880 × 1800 pixels, based on the
  active macOS display scale

The `artifacts` outputs are not source files. Do not commit them. Upload them to
App Store Connect in file-name order. The first three images also appear in the
installation sheet.

The release metadata is in `metadata/en-US.md`. The public privacy policy is in
the repository root.

Do not commit application archives, installer packages, certificates,
provisioning profiles, API keys, or other signing data. Keep source in Git. Put
signed public binaries in App Store Connect and, when needed, in GitHub Release
assets.
