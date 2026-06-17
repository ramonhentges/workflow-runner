---
status: completed
title: Wire `--host` flag through CLI parser and daemon command
type: backend
complexity: medium
dependencies:
    - task_01
---

# Task 02: Wire `--host` flag through CLI parser and daemon command

## Overview

Add `bindHost` to the `DaemonArgs` CLI interface and parse the `--host` flag in `parseDaemonArgs()`, update `USAGE.daemon` to document the new flag, and forward the value as `WORKFLOW_RUNNER_HOST` env var in `runStart()` so the spawned child process inherits it. This follows the exact same pattern as the existing `--api-port` / `WORKFLOW_RUNNER_API_PORT` wiring.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `DaemonArgs` in `src/app/cli.ts` MUST gain a `bindHost?: string` field
- `parseDaemonArgs()` MUST accept `--host <value>` and `--host=<value>` syntax, following the existing flag patterns
- `USAGE.daemon` MUST be updated to include `[--host <address>]`
- `runForeground()` in `src/app/commands/daemon.ts` MUST destructure `bindHost` from parsed args and pass it to `runDaemonFn({ bindHost })`
- `runStart()` in `src/app/commands/daemon.ts` MUST set `process.env.WORKFLOW_RUNNER_HOST` when `bindHost` is provided, following the `WORKFLOW_RUNNER_API_PORT` env-var pattern
- The `DaemonDeps.runDaemon` type signature in `src/app/commands/daemon.ts` MUST be updated to include `bindHost?: string`
</requirements>

## Subtasks

- [ ] 02.1 Add `bindHost?: string` to `DaemonArgs` interface
- [ ] 02.2 Add `--host` flag parsing in `parseDaemonArgs()` (both `--host <val>` and `--host=<val>` forms)
- [ ] 02.3 Update `USAGE.daemon` to include `[--host <address>]`
- [ ] 02.4 Update `runForeground()` to destructure and forward `bindHost`
- [ ] 02.5 Update `DaemonDeps.runDaemon` type to include `bindHost?: string`
- [ ] 02.6 Update `runStart()` to set `process.env.WORKFLOW_RUNNER_HOST`
- [ ] 02.7 Write tests for `--host` flag parsing and env var forwarding

## Implementation Details

See TechSpec "Data Models" section for the exact `DaemonArgs` interface change and "Development Sequencing" step 2 for the wiring. The `--host` flag parsing follows the `--storage-root` pattern (string value, no validation in parser) rather than the `--api-port` pattern (which validates port range).

### Relevant Files

- `src/app/cli.ts` — Add `bindHost` to `DaemonArgs`, implement `--host` parsing in `parseDaemonArgs()`, update `USAGE.daemon`
- `src/app/commands/daemon.ts` — Destructure `bindHost` in `runForeground()`, update `DaemonDeps.runDaemon` type, set env var in `runStart()`

### Dependent Files

- `src/app/cli.test.ts` — Add `--host` parsing tests to the `parseDaemonArgs` describe block
- `src/app/commands/daemon.test.ts` — Add test that `--host` flag is forwarded to `runDaemonFn` and env var is set

### Related ADRs

- [ADR-001: Configurable bind address for external access](../adrs/adr-001.md) — Selected `--host` flag name and `WORKFLOW_RUNNER_HOST` env var name

## Deliverables

- Updated `DaemonArgs` with `bindHost` field
- Updated `parseDaemonArgs()` accepting `--host` flag
- Updated `USAGE.daemon` documenting `--host`
- Updated `runForeground()` forwarding `bindHost` to `runDaemonFn`
- Updated `runStart()` setting `WORKFLOW_RUNNER_HOST` env var
- Updated tests for flag parsing and env var forwarding

## Tests

- Unit tests:
  - [ ] "parses `--host 0.0.0.0` into `DaemonArgs.bindHost`"
  - [ ] "parses `--host=0.0.0.0` into `DaemonArgs.bindHost`"
  - [ ] "parsing an IP address like `192.168.1.100` does not trigger port validation"
  - [ ] "empty argv produces undefined bindHost"
  - [ ] "`--api-port` and `--host` can be combined"
  - [ ] "forwards `--host` to `runDaemonFn` in foreground mode" (via injected `runDaemon` mock)
  - [ ] "sets `WORKFLOW_RUNNER_HOST` env var in `runStart()` when `bindHost` is provided"
  - [ ] "does not set `WORKFLOW_RUNNER_HOST` env var when `bindHost` is undefined"
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- `--host` flag is accepted by CLI and forwarded to daemon runtime
- `WORKFLOW_RUNNER_HOST` env var is set for detached spawns
- Existing `--api-port` and `--storage-root` parsing continues to work
