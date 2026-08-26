# Contributing

Thank you for helping Labelmaker support more printers and better
label workflows.

## Before a change

1. Read `AGENTS.md` and the specifications linked from it.
2. Keep printer protocols in separate adapter packages.
3. Keep Electron, Node, Bluetooth, and concrete adapters out of the UI package.
4. Add an issue or discussion before a large dependency, format, or architecture
   change.

## Local checks

Use Node 24 and npm 11 or later.

```bash
npm install
npm run check
npm run ui:screenshot
```

`npm run check` requires a React Doctor score of 100 with zero diagnostics.
Visual changes must include an inspected primary and compact screenshot.

## Printer adapters

- Start with fixed protocol tests and a fake or recording transport.
- Keep physical-printer tests opt-in.
- State the exact model, firmware, host operating system, and transport in a
  hardware test report.
- Never add device addresses, private captures, credentials, or vendor binaries.
- Respect the license of every reference implementation. Protocol facts can be
  documented, but do not copy incompatible source code.

## Pull requests

Keep a change focused. Explain its user-visible result, package boundaries,
tests, and hardware status. Do not describe an adapter as supported until the
listed physical tests pass.

Contributions are accepted under the Apache-2.0 license.
