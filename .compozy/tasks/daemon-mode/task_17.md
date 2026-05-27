---
status: completed
title: App CLI subcommand dispatcher
type: backend
complexity: low
dependencies:
  - task_15
  - task_16
---

# Task 17: App CLI subcommand dispatcher

## Overview
Replace `src/app/main.ts` with a thin argv-to-subcommand dispatcher. It parses the subcommand name, looks up the matching `commands/*.ts` `run()` function, invokes it with the remaining argv, and returns the resulting exit code. Owns the global `--help`/`-h` and `--version` handling.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST modify `src/app/main.ts` to export `async function main(argv: string[]): Promise<number>` that dispatches by subcommand name.
- MUST support these subcommands: `daemon`, `start`, `attach`, `detach`, `ps`, `send`, `retry-step`, `stop`, `doctor`.
- `detach` MUST: print a one-line message `detach is performed inside the TUI with /detach; this command is for documentation only` and return 0. (Real detach happens client-side inside the TUI; the existence of `workflow-runner detach` as a top-level CLI verb is documented as a UX no-op in V1.)
- MUST handle `workflow-runner --help` / `-h` / no-args: print the full subcommand list with one-line descriptions; return 0.
- MUST handle `workflow-runner --version`: print the version from `package.json`; return 0.
- MUST handle unknown subcommands: print `unknown subcommand '<x>'; see 'workflow-runner --help'`; return 1.
- MUST set the process exit code from the returned number (caller in `src/index.ts` does `process.exit(await main(...))`).
- MUST keep the existing `src/index.ts` shim unchanged in shape (`main(process.argv).then(process.exit)`).
- MUST update `src/index.ts` if needed so the new `main` signature works.
</requirements>

## Subtasks
- [x] 17.1 Refactor `src/app/main.ts` to the dispatcher pattern; delete or relocate the existing foreground-mode body.
- [x] 17.2 Implement subcommand lookup (a small `Map<string, (argv) => Promise<number>>` built from imports).
- [x] 17.3 Implement global `--help` / no-args usage output with one-line descriptions per subcommand.
- [x] 17.4 Implement `--version` reading from `package.json`.
- [x] 17.5 Implement the `detach` placeholder behavior.
- [x] 17.6 Update `src/index.ts` if signature changes (no change required — new `deps` param is optional).
- [x] 17.7 Write unit tests for dispatch behavior and global flags.

## Implementation Details
Modify `src/app/main.ts` in place. The existing imports of `Workflow`, `Runner`, `McpServer`, `Tui`, etc. all go away (they are now owned by `commands/*.ts` files). The new file imports each command module and registers its `run()` function. Read `package.json` for the version using `Bun.file('./package.json').json()` or `import.meta.resolve` to find it relative to the bundle — make it robust to both `bun src/index.ts` and the future `bin` invocation.

### Relevant Files
- `src/app/main.ts` (currently 88 lines) — being refactored to dispatcher.
- `src/index.ts` (currently 11 lines) — shim that calls `main(process.argv)`.
- `src/app/cli.ts` — currently holds `parseCliArgs`; will be refactored in task 18.
- `src/app/commands/*` (tasks 15, 16) — registered subcommands.

### Dependent Files
- `src/app/cli.ts` (task 18) — will move per-subcommand parsing into here.
- All `src/app/commands/*.ts` (tasks 15, 16) — invoked by this dispatcher.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — establishes the subcommand surface.
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — establishes `app/main.ts` as a thin router.

## Deliverables
- Refactored `src/app/main.ts` (the dispatcher).
- Updated `src/index.ts` if needed.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `main(["bun", "src/index.ts", "ps"])` invokes the `ps` command's `run` function (mock the command imports); returns the value the command returned.
  - [x] `main(["bun", "src/index.ts", "start", "wf.json"])` invokes `start.run(["wf.json"])`.
  - [x] `main(["bun", "src/index.ts", "--help"])` writes the usage block to stdout; returns 0; does NOT invoke any command.
  - [x] `main(["bun", "src/index.ts"])` (no-args) writes usage; returns 0.
  - [x] `main(["bun", "src/index.ts", "--version"])` writes a version string ending in a digit; returns 0.
  - [x] `main(["bun", "src/index.ts", "doesnotexist"])` writes `unknown subcommand 'doesnotexist'` to stderr; returns 1.
  - [x] `main(["bun", "src/index.ts", "detach"])` writes the documentation-only message; returns 0; does NOT call `client.connect()`.
  - [x] `main(["bun", "src/index.ts", "-h"])` is treated identically to `--help`.
- Integration tests:
  - [ ] Covered by task 19 (every scenario invokes the dispatcher via the CLI entry).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `src/app/main.ts` is under 100 lines (it is a thin dispatcher).
- No imports of `Workflow`, `Runner`, `McpServer`, or `Tui` remain in `main.ts` after the refactor.
