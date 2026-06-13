# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Surface `RunSnapshot.initialPrompt` in the attached TUI as the opening transcript
entry. Pure TUI + attach-loop wiring; no daemon/HTTP/protocol changes (snapshot
field from task 01 already flows through `run.attach` `initialSnapshot`).

## Important Decisions

- New `Tui.showInitialPrompt(prompt?: string)` renders the prompt like the user's
  first message using the same `> {text}` / `C.blue` form as `submitInput`, via the
  private `appendLog`. No-op (early return) when prompt is falsy/empty.
- Attach loop calls `tui.showInitialPrompt(initialSnapshot.initialPrompt)` right
  after `tui.setIsolation(...)` and BEFORE `attachSource`, so the prompt is the
  opening entry, ahead of replayed backlog events.

## Learnings

- `_attach-loop.ts` is deliberately excluded from unit coverage (depends on
  `@opentui/core` real-terminal init). Integration test for the attach flow is
  written against the Tui directly with the test renderer, replicating the
  attach-loop wiring order (setIsolation -> showInitialPrompt -> attachSource).

## Files / Surfaces

- `src/infra/tui/tui.ts` — add `showInitialPrompt`.
- `src/app/commands/_attach-loop.ts` — wire the call.
- `src/infra/tui/tui.test.ts` — unit + integration-style tests.

## Errors / Corrections

- Tracking files provided inline in the prompt still must be Read via the tool
  before Edit (harness state), even though their content was in the brief.

## Ready for Next Run

Task complete. `Tui.showInitialPrompt` added + wired in `_attach-loop.ts`.
Verification: tui.test.ts 30 pass; full suite 1160 pass / 1 skip / 0 fail;
`tsc --noEmit` clean; tui.ts coverage 99.44% lines. Auto-commit disabled — diff
left for manual review.
