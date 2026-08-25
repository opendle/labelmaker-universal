# Desktop application

This directory is the Electron composition root. It owns the main process, the
secure preload bridge, the application window, and adapter registration. The
React interface belongs in `packages/ui`.

The current shell connects the interface to the mock printer adapter. Save and
print actions are temporary in-memory operations. Local file storage will be
added with the document renderer milestone.

Run the application from the repository root:

```bash
npm run dev
```

Capture the two supported desktop sizes with:

```bash
npm run ui:screenshot
```
