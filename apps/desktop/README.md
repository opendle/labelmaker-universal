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
