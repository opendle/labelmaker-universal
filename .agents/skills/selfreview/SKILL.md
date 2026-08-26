---
name: selfreview
description: Review your own recent Labelmaker changes with a skeptical pass. Use after implementation to find defects, missing work, risks, and unintended changes before commit; automode fixes material findings and runs the required checks without a user prompt.
---

# Self-Review

Review the current task changes against the user request, the applicable
specification, and the repository rules. Try to find what the implementation
missed before the work ships.

## Modes

- **Interactive** is the default. Report material findings, ask the user which
  findings to fix, and then apply the selected fixes.
- **Automode** fixes all `BUGS`, `MISSING`, and `RISKY` findings without a user
  prompt. Use this mode for `$selfreview automode`, `--automode`, or when
  `AGENTS.md` requires the end-of-task review.

Do not commit or push from this skill. Return control to the task workflow after
the review and quality gates finish.

## 1. Establish the review scope

Capture the task intent from the user request and any implementation notes.
Read `docs/product.md`, `docs/architecture.md`, and the specification that owns
the changed behavior.

Inspect the current state:

```bash
git status --short
git diff --stat
git diff
git diff --cached
git log --oneline -5
```

Review only changes that belong to the current task. A shared worktree can
contain user or agent changes from other tasks. Use the starting status, task
scope, and path-specific diffs to separate them. Do not edit, stage, or report
unrelated changes as your own findings.

Inspect each task-owned untracked file directly. `git diff` does not show an
untracked file.

If the current task has commits that are not on the target branch, also inspect
the range diff and its commit messages. Do not assume that `main...HEAD` has a
diff when work occurs directly on `main`.

## 2. Review the changes

Be skeptical. Trace changed code with edge inputs and failure paths. Confirm
that each changed line supports the task and that the complete task is present.

### Correctness and completeness

- Compare behavior with the request and the owning specification.
- Check empty values, missing values, bounds, units, rotation, scaling, and
  printer-pixel conversions where they apply.
- Check error and cancellation paths. A printer failure must not damage the
  open workspace.
- Check all callers after a type, name, interface, IPC message, or saved format
  changes.
- Confirm that new behavior has focused tests. Use deterministic protocol
  vectors for printer commands.
- Update the applicable specification for a public contract or persisted
  format change. Require an ADR for a hard-to-reverse architecture choice.

### Architecture and trust boundaries

- Keep document, domain, rendering, printing, adapter, UI, and shell package
  boundaries from `docs/architecture.md`.
- Keep adapters transport-specific and UI-independent. They receive a
  transport-neutral monochrome raster, not editor elements.
- Keep the shared UI free of Electron, Node file APIs, operating-system APIs,
  Bluetooth libraries, and concrete adapters.
- Validate untrusted documents, IPC payloads, adapter results, and server
  requests at their boundaries.
- Keep Electron `contextIsolation` enabled, `nodeIntegration` disabled, and the
  preload API narrow.
- Check for secret data, device addresses, or raw packet data in normal errors
  and logs.

### Desktop UI changes

- Keep the interface a focused desktop tool with a clear canvas and a short
  path to print.
- Check keyboard access, visible focus, disabled states, empty states, and error
  feedback.
- Check the primary and compact sizes from `docs/ui-spec.md`.
- Look for state or DOM changes that break selection, drag, resize, undo, redo,
  plate order, preview, save, or print.

### Consistency and unintended effects

- Check strict TypeScript types, imports, names, and nearby patterns.
- Search for other callers and stale assumptions with `rg`.
- Check that a new dependency or abstraction has a concrete need.
- Check that generated output, dependencies, secrets, and temporary screenshots
  are not part of the task diff.
- Do not turn an optional cleanup into a required finding unless it causes a
  real defect or maintenance risk in the changed code.

## 3. Record findings

Use these groups:

- `BUGS`: the change causes an error or wrong behavior.
- `MISSING`: work that the request or specification requires is absent.
- `RISKY`: the change can fail under a specific realistic condition.
- `NITPICKS`: optional small improvements.

Each finding must include `file:line`, the real trigger, the effect, and a
specific fix. Do not add generic advice or invent findings. An empty report is
valid.

## 4. Triage and fix

In interactive mode, report the material findings and ask the user what to fix.
Do not pause for an empty report.

In automode:

1. Fix every `BUGS`, `MISSING`, and `RISKY` finding that belongs to this task.
2. Fix a `NITPICKS` finding only when the change is small, safe, and in scope.
3. Do not ask the user to approve routine in-scope fixes.
4. Stop and report a blocker when a fix needs new authority, a product choice,
   or edits to unrelated work.
5. Review the resulting task diff again after fixes.

## 5. Run quality gates

Run the checks that match the change. Always run the repository gate before
returning:

```bash
npm run check
```

React Doctor must score 100 with zero diagnostics. For a material visual
change, also run the UI smoke and screenshot command:

```bash
npm run ui:screenshot
```

Inspect the current screenshots after the command. Do not replace screenshots
for a non-visual task.

If a gate fails because of unrelated dirty work, do not edit or discard that
work. Run any safe focused checks that can prove the current task, then report
the exact unrelated blocker.

Return a concise summary of findings, fixes, checks, and blockers. Do not commit
or push; the caller does that after self-review completes.
