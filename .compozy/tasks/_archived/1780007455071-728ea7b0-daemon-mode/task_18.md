---
status: completed
title: CLI parser refactor
type: refactor
complexity: low
dependencies:
  - task_17
---

# Task 18: CLI parser refactor

## Overview
Refactor `src/app/cli.ts` to provide a per-subcommand argv parser API consumed by every `commands/*.ts` file. Replaces inline parsing currently in each command with a single tested parser surface. Pure cleanup with no behavioral change.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST modify `src/app/cli.ts` to expose one typed parser per subcommand: `parseStartArgs(argv)`, `parseStopArgs(argv)`, `parseRetryStepArgs(argv)`, `parsePsArgs(argv)`, `parseAttachArgs(argv)`, `parseSendArgs(argv)`, `parseDoctorArgs(argv)`, `parseDaemonArgs(argv)`.
- Each parser MUST return a discriminated `{ok: true, value: <args>} | {ok: false, error: string}` shape so commands can produce consistent error messages.
- Parsers MUST recognize `--help`/`-h` per-subcommand and return a special `{ok: true, help: true}` flag that commands handle by printing usage and returning 0.
- MUST remove the legacy `parseCliArgs(argv: string[])` and `resolveEntryStep(...)` functions from `src/app/cli.ts` and update the lone caller (which is the deleted foreground main).
- MUST update existing `src/app/cli.test.ts` to cover the new per-subcommand parsers; old tests for `parseCliArgs` may be removed or rewritten.
- MUST update each `commands/*.ts` file (tasks 15, 16) to call the matching parser instead of inline parsing.
- MUST NOT change any subcommand's behavior — purely an extraction refactor.
</requirements>

## Subtasks
- [x] 18.1 Define the eight parser functions in `src/app/cli.ts` with typed return shapes.
- [x] 18.2 Remove the legacy `parseCliArgs` and `resolveEntryStep` exports.
- [x] 18.3 Update each `src/app/commands/*.ts` to use the new parser.
- [x] 18.4 Update `src/app/cli.test.ts` with tests for each new parser.

## Implementation Details
Modify `src/app/cli.ts`. The current file has two exports: `parseCliArgs` and `resolveEntryStep`. Both go away. Replace with the per-subcommand parsers. Each parser is small (typically < 20 LOC) so they can all live in one file; if the file grows past ~300 LOC, consider splitting into `src/app/cli/parsers.ts` etc. — but probably not needed.

### Relevant Files
- `src/app/cli.ts` (currently 88 LOC) — being refactored.
- `src/app/cli.test.ts` — existing tests, being rewritten.
- `src/app/commands/*.ts` (tasks 15, 16) — call sites being updated.

### Dependent Files
- `src/app/main.ts` (task 17) — already updated; no further change.

### Related ADRs
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — establishes that subcommand parsing lives in `app/cli.ts`.

## Deliverables
- Refactored `src/app/cli.ts` with eight typed parsers.
- Updated `src/app/commands/*.ts` files using the parsers.
- Updated `src/app/cli.test.ts`.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `parseStartArgs(["wf.json"])` returns `{ok: true, value: {workflowPath: "wf.json", detach: false}}`.
  - [ ] `parseStartArgs(["wf.json", "--detach"])` returns `{value: {workflowPath: "wf.json", detach: true}}`.
  - [ ] `parseStartArgs(["wf.json", "-d"])` returns `{value: {workflowPath: "wf.json", detach: true}}`.
  - [ ] `parseStartArgs([])` returns `{ok: false, error: /workflow path/i}`.
  - [ ] `parseStartArgs(["--help"])` returns `{ok: true, help: true}`.
  - [ ] `parseStopArgs(["abc12345"])` returns `{value: {runId: "abc12345"}}`.
  - [ ] `parseStopArgs([])` returns `{ok: false, error: /run id/i}`.
  - [ ] `parseSendArgs(["abc", "hello world"])` returns `{value: {runId: "abc", message: "hello world", fromStdin: false}}`.
  - [ ] `parseSendArgs(["abc", "-"])` returns `{value: {runId: "abc", message: "", fromStdin: true}}`.
  - [ ] `parseAttachArgs([])` returns `{value: {runId: null}}`.
  - [ ] `parseAttachArgs(["abc"])` returns `{value: {runId: "abc"}}`.
  - [ ] `parseRetryStepArgs(["abc"])` returns `{value: {runId: "abc"}}`.
  - [ ] `parsePsArgs([])` returns `{value: {all: false}}`.
  - [ ] `parsePsArgs(["--all"])` returns `{value: {all: true}}`.
  - [ ] `parseDoctorArgs([])` returns `{value: {}}`.
  - [ ] `parseDaemonArgs([])` returns `{value: {}}`.
  - [ ] Every parser handles `--help` symmetrically: `{ok: true, help: true}`.
  - [ ] No parser mutates its argv argument.
- Integration tests:
  - [ ] Covered by task 19 (every scenario goes through the parsers via the CLI entry).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No inline argv parsing remains in `src/app/commands/*.ts` (verified by grep).
- The legacy `parseCliArgs` and `resolveEntryStep` exports are gone from `src/app/cli.ts`.
