# Labelmaker — agent instructions

## Start here

Read these files before you change behavior:

1. `docs/product.md`
2. `docs/architecture.md`
3. The specification for the area that you will change

Use the `labelmaker-desktop-ui` skill for editor or desktop UI work. Use the
`printer-adapter-development` skill for printer support.
Use the `selfreview` skill in automode at the end of each task that changes the
repository, after the first checks and before the commit.

## Product rules

- Build a desktop application. Do not make the interface look like a marketing
  website or an administration dashboard.
- Keep the first release simple. Favor direct controls, a clear canvas, and a
  short path from opening the application to printing a label.
- A saved workspace can contain many labels. Call each label a plate in code.
- Keep printer communication fully separate from the UI and document model.
- Treat every manufacturer or protocol family as an adapter.
- Render a plate to a transport-neutral monochrome raster before an adapter
  receives it. An adapter must not understand editor components.
- Keep macOS, Windows, Linux, and server use possible. Isolate OS APIs in
  transport implementations and Electron APIs in the desktop application.

## Package boundaries

- `packages/domain`: saved documents, plates, elements, and units only.
- `packages/documents`: workspace validation and JSON serialization only.
- `packages/printing`: printer contracts, registry, sessions, and print jobs.
- `packages/adapters/*`: concrete printer or mock adapters.
- `packages/ui`: shared React editor and application UI.
- `apps/desktop`: Electron main process, preload bridge, and desktop assembly.
- `apps/server`: optional headless API and local print-bridge assembly.
- The UI can depend on domain types and application-facing ports. It must not
  import Electron, Node file APIs, Bluetooth libraries, or concrete adapters.
- Concrete adapters can depend on `domain` and `printing`. They must not depend
  on UI packages.

## Engineering workflow

- Use TypeScript in strict mode.
- Prefer LSP symbol tools for definitions, references, and safe edits when they
  are available. Use `rg` for broad searches.
- Add or update tests for behavior. Use deterministic test vectors for printer
  protocols.
- Validate untrusted files, IPC payloads, adapter results, and server requests.
- Keep Electron `contextIsolation` enabled and `nodeIntegration` disabled.
- Run `npm run check` before handoff. React Doctor must score 100 with zero
  diagnostics. Run `npm run ui:screenshot` and inspect current screenshots only
  after a material UI change. Do not run it for small UI changes.
- Review the complete diff after tests. Do not commit generated build output,
  dependencies, local secrets, or temporary screenshots.

## Change control

- Update the relevant specification when a public contract or persisted format
  changes.
- Add an architecture decision record for a choice that is hard to reverse.
- Do not add a new framework, state library, database, or dynamic plug-in loader
  without a concrete need.
- Preserve unrelated user changes. Do not rewrite the repository structure for
  a local feature.

## Task completion

- Run `selfreview` in automode. Fix all material findings and complete its
  quality gates before you commit.
- After all requested work and checks are complete, make a signed commit that
  contains the integrated task changes and push it to the `main` branch.
- Do not commit partial work while another agent still changes the shared
  worktree.
- Never disable or bypass commit signing.
