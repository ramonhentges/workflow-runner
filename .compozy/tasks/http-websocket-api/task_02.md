---
status: completed
title: Thread explicit cwd through run start (RunManager + JSON-RPC + CLI)
type: backend
complexity: medium
dependencies: []
---

# Task 2: Thread explicit cwd through run start (RunManager + JSON-RPC + CLI)

## Overview
Make the runner's working directory an explicit input to starting a run instead of silently
defaulting to the daemon's `process.cwd()`. This is the prerequisite for the HTTP `POST /runs`
endpoint (which has no ambient shell) and removes the footgun where agents run in the daemon's
arbitrary directory.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `RunManager.startRun` MUST take a required `cwd` parameter and pass it to the `Runner` via
  `new Runner(workflow, factory, mcp, { cwd, onStepBoundary })`.
- The JSON-RPC `run.start` params MUST gain a `cwd` field (additive to `protocol.ts`).
- The `run.start` handler MUST forward `cwd` to `RunManager.startRun`.
- The CLI `start` command/client MUST populate `cwd` from its own `process.cwd()` so existing CLI
  behavior is preserved exactly.
- The change MUST keep all existing run-manager, handler, and CLI tests green (update fixtures/call
  sites as needed).
</requirements>

## Subtasks
- [x] 2.1 Change `RunManager.startRun(workflowPath, cwd)` and thread `cwd` into the `Runner` options.
- [x] 2.2 Add `cwd` to the `run.start` params type in `protocol.ts`.
- [x] 2.3 Update the `run.start` handler to pass `cwd` through.
- [x] 2.4 Update the CLI `start` command + UDS client to send `process.cwd()` as `cwd`.
- [x] 2.5 Update affected call sites/fixtures so existing tests pass.

## Implementation Details
`Runner` already accepts `opts.cwd` (defaulting to `process.cwd()`); the gap is that
`RunManager.startRun` never passes it (see `src/infra/daemon/run-manager.ts` `new Runner(...)`).
Thread it through. See TechSpec "Impact Analysis" rows for run-manager/protocol/run-start/CLI and
"Key Decisions" (cwd required over HTTP, CLI defaults to process.cwd()). This task touches only the
existing JSON-RPC + CLI path; the HTTP body validation lives in task 07.

### Relevant Files
- `src/infra/daemon/run-manager.ts` — `startRun` signature + `new Runner(...)` call.
- `src/domain/runner.ts` — `RunnerOptions.cwd` already supported (no change expected).
- `src/infra/daemon/protocol.ts` — `run.start` params type.
- `src/infra/daemon/handlers/run-start.ts` — forwards params to `startRun`.
- `src/app/commands/start.ts` — CLI start entry point.
- `src/infra/client/client.ts` — UDS client request builder.

### Dependent Files
- `src/infra/daemon/run-manager.test.ts`, `handlers/handlers.test.ts`, `app/commands/start.test.ts` — call sites/fixtures to update.
- `src/app/api/` task 07 (`POST /runs`) — consumes the new `cwd` parameter.

### Related ADRs
- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](../adrs/adr-002.md) — explicit spawn path decision.
- [ADR-003: RunManager is the shared application service](../adrs/adr-003.md) — `startRun(workflowPath, cwd)` is the shared signature.

## Deliverables
- `RunManager.startRun(workflowPath, cwd)` threading cwd into `Runner`.
- `run.start` params + handler + CLI client carrying `cwd`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for cwd propagation **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `startRun` passes the provided `cwd` to the `Runner` (assert via injected/fake session factory capturing `args.cwd`).
  - [x] The `run.start` handler forwards `params.cwd` unchanged to `startRun`.
  - [x] The CLI start path sends `process.cwd()` as `cwd` in the JSON-RPC request.
- Integration tests:
  - [x] End-to-end CLI `start <workflow>` launches a run whose agent session receives the CLI's cwd (fixture session factory).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Starting a run via the CLI behaves identically to today.
- `RunManager.startRun` requires and honors an explicit `cwd`.
