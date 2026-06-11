---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T18:25:47Z
status: resolved
file: src/infra/tui/tui.ts
line: 143
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: CLI attach surface (TUI) never shows branch/worktree

## Review Comment

PRD *Core Feature #3 — Worktree path and branch visibility (must-have)* states
isolation info must appear "Wherever a run appears," and explicitly names the
CLI surfaces:

> CLI: run listing (`ps`) and attach surfaces.

and the *User Experience* section:

> in `ps`/attach and in the web run details, an isolated run displays its branch
> and worktree path alongside its normal status.

Three of the four surfaces honor this:

- `ps` — `formatIsolationLine` renders a `↳ branch … worktree …` continuation
  line (`src/infra/client/format.ts:79`).
- web run detail — `RunView` renders the `isolation-info` block
  (`web/src/features/run-view/RunView.tsx:23`).

But the **CLI attach surface (the TUI)** does not. The RPC `run.attach` result
carries the fields — `initialSnapshot: RunSnapshot` now includes
`worktreePath`/`branch` (protocol.ts:45, run.ts:16) — yet the TUI never reads
them. The header `BoxRenderable` only adds `statusText`
(`src/infra/tui/tui.ts:143-152`); there is no rendering of branch or worktree
anywhere in the attach view. A user who starts an isolated run and stays
attached (the default on a TTY) never sees the worktree path the PRD intends to
"teach users where isolated work lives."

This is a partial implementation of a must-have requirement. The task breakdown
(`task_06`) narrowed CLI rendering to `ps` only, but that scoping diverges from
the PRD, which lists attach as a named surface.

Suggested fix: surface branch/worktree in the TUI when present on the attached
snapshot — e.g. add a compact line/segment to the header (consistent with the
web `isolation-info` block) gated on `worktreePath || branch`, so non-isolated
runs render unchanged. Add a TUI/event-source test asserting the fields render
for an isolated snapshot and are absent otherwise.

## Triage

- Decision: `VALID`
- Root cause: The `run.attach` RPC result carries `initialSnapshot: RunSnapshot`
  (with optional `worktreePath`/`branch`), and `_attach-loop.ts` already
  receives it, but it is never forwarded to the `Tui`. The TUI header
  (`tui.ts`) only renders `statusText`, so an attached user never sees the
  branch/worktree of an isolated run — diverging from PRD Core Feature #3,
  which names "attach surfaces" explicitly. `ps`, web detail honor it; attach
  does not.
- Fix approach:
  1. `tui.ts`: add a dim `isolationText` segment to the header `BoxRenderable`
     (initially empty so non-isolated runs render unchanged) plus a public
     `setIsolation({ branch?, worktreePath? })` method that renders a compact
     `↳ branch … worktree …` segment, mirroring `formatIsolationLine`
     (`format.ts:79`) for cross-CLI consistency. Empty input clears the segment.
  2. `_attach-loop.ts` (out of the scoped code-file list, but the only place the
     attach snapshot is available to feed the TUI — change limited to a single
     `tui.setIsolation(initialSnapshot)` call): forward the attach snapshot's
     isolation fields. This file is intentionally outside unit-test coverage;
     the new behavior is unit-tested directly against `Tui.setIsolation`.
- Tests: added TUI tests asserting the header shows `branch`/`worktree` for an
  isolated snapshot, omits them when absent, and clears when re-set empty.
