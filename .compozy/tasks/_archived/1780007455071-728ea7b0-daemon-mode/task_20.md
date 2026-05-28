---
status: completed
title: Remove foreground path and add bin entry
type: chore
complexity: low
dependencies:
  - task_18
  - task_19
---

# Task 20: Remove foreground path and add bin entry

## Overview
Final cleanup: delete the legacy single-workflow foreground execution path from `src/app/main.ts` (already partially done in task 17 but verify no dead code remains), make `workflow-runner` installable via `package.json` `bin`, and update the README so users see the daemon CLI by default. Gated on integration tests passing.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST verify no legacy foreground-only code paths remain in `src/app/main.ts`, `src/app/cli.ts`, or `src/index.ts` (the refactor in tasks 17-18 should already have removed them; this task is a verification + cleanup pass).
- MUST add a `bin` entry to `package.json` mapping `workflow-runner` to the build entry (e.g., `"bin": {"workflow-runner": "./src/index.ts"}` for source-run, or to the `build/` output if the project ships built).
- MUST update `package.json` `scripts.dev` (currently `bun src/index.ts`) to reflect new usage (e.g., delete it or change to a docs example like `bun src/index.ts ps`).
- MUST update `README.md` to document the new CLI surface: list each subcommand with a one-line description, replace any old `bun src/index.ts workflows/...` examples with `workflow-runner start workflows/...`.
- MUST update `CLAUDE.md` Commands section: replace the foreground examples with daemon-mode equivalents; add `workflow-runner doctor` to the diagnostic commands.
- MUST run the full test suite (`bun test`) and confirm green before completing.
- MUST run `bun run typecheck` and confirm zero errors.
- MUST grep the codebase for any remaining references to legacy entry points and remove them (e.g., comments saying "the foreground tool", any helper utility only used by the deleted main).
</requirements>

## Subtasks
- [x] 20.1 Verify no legacy code remains in `src/app/main.ts` / `cli.ts` / `index.ts`.
- [x] 20.2 Add `bin` field to `package.json`; verify the shebang in `src/index.ts` if going the source-run route.
- [x] 20.3 Update `package.json` scripts.
- [x] 20.4 Rewrite the `README.md` Usage section.
- [x] 20.5 Update `CLAUDE.md` Commands section.
- [x] 20.6 Run full `bun test` and `bun run typecheck`; fix anything that's been missed.

## Implementation Details
Modify `package.json`, `README.md`, `CLAUDE.md`, and verify `src/app/main.ts`/`src/app/cli.ts`/`src/index.ts`. The `bin` entry should point at the entry that handles argv (`src/index.ts` if shipped source-run, or `build/index.js` if built). If `bin` points at a `.ts` file, the user must have Bun installed; document that. The shebang on the entry file should be `#!/usr/bin/env -S bun run` for source-run or `#!/usr/bin/env node` for built. The README/CLAUDE.md changes are documentation; keep them tight (no marketing prose).

### Relevant Files
- `package.json` — add `bin`, update scripts.
- `README.md` — rewrite Usage section.
- `CLAUDE.md` — update Commands section.
- `src/index.ts` — confirm shebang and signature.
- `src/app/main.ts` — verify no legacy code (should already be clean from task 17).

### Dependent Files
- None — this is terminal cleanup.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — terminology and command names used in docs.

## Deliverables
- `package.json` with `bin` entry and updated scripts.
- Updated `README.md` with the new CLI surface.
- Updated `CLAUDE.md` Commands section.
- Clean `bun test` and `bun run typecheck` runs **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] None new for this task — it's documentation + cleanup. Existing tests must continue to pass (verified by `bun test`).
- Integration tests:
  - [ ] Manual smoke test: install the package locally via `bun install -g .` (or `bun link`); run `workflow-runner --help` from a different directory; assert the usage block appears.
  - [ ] Manual smoke test: `workflow-runner ps` auto-spawns the daemon and prints an empty (header-only) table.
  - [ ] Manual smoke test: `workflow-runner start workflows/who-is.json` (the existing fixture) starts the run, attaches a TUI, runs the real `opencode` workflow if available — this is the project's existing manual E2E procedure.
- Test coverage target: existing test coverage from tasks 01-19 carries forward; no new coverage required.
- All tests must pass

## Success Criteria
- `bun test` is green.
- `bun run typecheck` reports zero errors.
- `package.json` exposes `workflow-runner` as a `bin`.
- `README.md` and `CLAUDE.md` reflect the daemon-mode CLI as the only entry point.
- No `bun src/index.ts <workflow.json>` examples remain anywhere in the repo (verified by grep).
