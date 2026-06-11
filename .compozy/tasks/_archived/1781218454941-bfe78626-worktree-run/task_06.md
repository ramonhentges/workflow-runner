---
status: completed
title: CLI start --branch flag and run output rendering
type: backend
complexity: medium
dependencies:
  - task_04
---

# Task 6: CLI start --branch flag and run output rendering

## Overview
Add an opt-in `--branch <name>` flag to the `start` command so a run can be launched in isolation from the terminal, and render the worktree/branch for isolated runs in `ps` output. This is the CLI entry point for the feature, parallel to the web entry point.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `parseStartArgs` MUST accept `--branch <name>` (and reject `--branch` with no value); the `start` command MUST forward `branch` in the `run.start` call.
- Supplying `--branch` MUST request isolation; omitting it MUST preserve today's behavior exactly.
- The `start` USAGE string MUST document the flag.
- `start` MUST surface `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` failures with clear messages and start nothing.
- `ps` (and run output) MUST display the branch and worktree path for isolated runs without disrupting the existing columns for non-isolated runs.
</requirements>

## Subtasks
- [x] 6.1 Parse `--branch <name>` in `parseStartArgs` and add it to the parsed value type.
- [x] 6.2 Forward `branch` from the `start` command into `run.start` and map the new error codes to messages.
- [x] 6.3 Update the `start` USAGE entry.
- [x] 6.4 Render branch/worktree for isolated runs in the `ps` formatter.

## Implementation Details
Modify `src/app/cli.ts` (`parseStartArgs`, `StartArgs`, `USAGE.start`), `src/app/commands/start.ts` (pass `branch`, extend `formatStartError`), and `src/infra/client/format.ts` (`formatPsTable` currently renders slug/workflow/step/status/elapsed — add branch/worktree display for isolated rows). See TechSpec "API Endpoints" (CLI line) and "Impact Analysis".

### Relevant Files
- `src/app/cli.ts` — `parseStartArgs`, `USAGE`.
- `src/app/commands/start.ts` — `run.start` call and `formatStartError`.
- `src/infra/client/format.ts` — `formatPsTable` / run output rendering.
- `src/infra/client/format.test.ts` — formatter tests to extend.

### Dependent Files
- None downstream; this is a leaf entry point.

### Related ADRs
- [ADR-001: Opt-in per-run git worktree isolation with a user-provided branch](adrs/adr-001.md) — Opt-in, user-provided branch at start.
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Fields rendered in `ps`.

## Deliverables
- `start --branch <name>` flag wired to `run.start`.
- Clear CLI error messages for non-repo and worktree-conflict failures.
- `ps` output showing branch/worktree for isolated runs.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the start command forwarding `branch` **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `parseStartArgs` parses `--branch feature-x` into `{ branch: "feature-x" }` and still parses `--detach`.
  - [ ] `parseStartArgs` returns an error when `--branch` is given without a value.
  - [ ] `parseStartArgs` without `--branch` yields no branch (unchanged shape).
  - [ ] `formatStartError` produces distinct messages for `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT`.
  - [ ] `formatPsTable` renders the branch/worktree for an isolated run row and renders a non-isolated row unchanged.
- Integration tests:
  - [ ] `start <workflow> --branch b` forwards `branch: "b"` in the `run.start` call (verified against a stub/recording client).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `--branch` launches an isolated run; omitting it is unchanged
- `ps` clearly shows isolation for isolated runs
