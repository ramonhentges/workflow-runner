---
status: completed
title: App commands — lifecycle (start, stop, retry-step, ps)
type: backend
complexity: medium
dependencies:
  - task_12
  - task_13
  - task_14
---

# Task 15: App commands — lifecycle (start, stop, retry-step, ps)

## Overview
Implement four CLI subcommand entries that the dispatcher routes to: `start`, `stop`, `retry-step`, `ps`. Each parses its own argv, calls the client, formats the result, sets the exit code. These are the user-facing surface for the run lifecycle features.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/app/commands/start.ts`, `stop.ts`, `retry-step.ts`, `ps.ts`.
- Each command MUST export `async function run(argv: string[]): Promise<number>` (the exit code).
- `start` MUST:
  - Parse positional `workflowPath` argument and the `--detach`/`-d` flag.
  - Call `client.connect()` then `client.call("run.start", {workflowPath})`.
  - If `--detach` is set OR stdout is NOT a TTY, print `{runId} {slug}\n` to stdout and exit 0.
  - Otherwise, immediately call `client.call("run.attach", {runId})` and host a local `Tui` over a `TuiEventSource` adapter that wraps `client.subscribe(...)`; return exit code 0 on clean exit, 1 if the run reached `failed`/`crashed`/`aborted` while attached.
- `stop` MUST: parse positional `runId` argument; call `client.call("run.stop", {runId})`; print `aborted run {runId}` to stdout; exit 0. Error path prints the daemon error message to stderr and exits 1.
- `retry-step` MUST: parse positional `runId`; call `client.call("run.retryStep", {runId})`; print `↻ retrying step-{resumedStepId} — LLM output may differ from the previous attempt` to stdout; exit 0.
- `ps` MUST: call `client.call("run.ps", {})`; pass the result to `formatPsTable(...)` from task 13; print to stdout; exit 0. With `--all` flag (V1: just a placeholder, not implemented past parsing), the column set is the same.
- Each command MUST print a clear, actionable message on `DaemonRpcError`, mapping known codes to human-readable text (e.g., `UNKNOWN_RUN` → `no run with id '<input>'; see 'workflow-runner ps' for current runs`).
</requirements>

## Subtasks
- [x] 15.1 Implement `start.ts` including the TTY-detection branch and the in-process attach loop.
- [x] 15.2 Implement `stop.ts` with the success print and error mapping.
- [x] 15.3 Implement `retry-step.ts` with the disclaimer banner print.
- [x] 15.4 Implement `ps.ts` calling `formatPsTable` and writing to stdout.
- [x] 15.5 Implement a thin `TuiEventSource` adapter (`src/app/commands/_tui-source.ts`) that wraps `DaemonClient.subscribe` and `DaemonClient.call("run.send", …)` for use by `start` and `attach` (task 16).
- [x] 15.6 Write unit tests with a mock `DaemonClient`.

## Implementation Details
Create the four command files plus the shared `_tui-source.ts` adapter. Each command does its own minimal argv parsing inline; the proper per-subcommand parser refactor happens in task 18. The TTY detection uses `process.stdout.isTTY`. The `_tui-source.ts` adapter implements `TuiEventSource` (from task 14): `subscribe(observer)` delegates to `client.subscribe` with a predicate matching `event.run.event` for the specific run id; `sendInput(text)` calls `client.call("run.send", {runId, message: text})`; `detach()` closes the subscription via the unsubscribe function returned from `client.subscribe`.

### Relevant Files
- `src/infra/client/client.ts` (task 12) — connect, call, subscribe.
- `src/infra/client/format.ts` (task 13) — `formatPsTable`.
- `src/infra/tui/tui.ts` (task 14) — `Tui.create()` + `attachSource()`.
- `src/infra/tui/event-source.ts` (task 14) — `TuiEventSource` interface.

### Dependent Files
- `src/app/main.ts` (task 17) — dispatches argv to the right `commands/*` `run()` function.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — `start` auto-attach default, exit codes, error messages.

## Deliverables
- Four command files plus `_tui-source.ts` adapter.
- Mock `DaemonClient` test helper exported from `src/infra/client/__tests__/mock-client.ts`.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `start.run(["workflow.json"])` with TTY mock-true: invokes `client.call("run.start",…)` then `client.call("run.attach",…)`; returns 0 on clean detach.
  - [x] `start.run(["workflow.json", "--detach"])`: invokes only `run.start`; prints `{runId} {slug}\n` to stdout; returns 0.
  - [x] `start.run(["workflow.json"])` with TTY mock-false: same as `--detach`; verifies the non-TTY auto-detach rule.
  - [x] `start.run([])` (missing workflow path): prints a usage error to stderr; returns 1.
  - [x] `stop.run(["abc12345"])`: invokes `client.call("run.stop",{runId:"abc12345"})`; prints `aborted run abc12345`; returns 0.
  - [x] `stop.run(["zzz"])` with a daemon error `UNKNOWN_RUN`: prints the actionable message including the `ps` hint; returns 1.
  - [x] `retry-step.run(["abc"])` invokes `run.retryStep`; prints the disclaimer banner exactly as `↻ retrying step-{X} — LLM output may differ from the previous attempt`; returns 0.
  - [x] `retry-step.run(["abc"])` with a daemon `RUN_NOT_RETRY_ELIGIBLE` error: prints `cannot retry run 'abc': run is currently running`; returns 1.
  - [x] `ps.run([])`: invokes `run.ps`; pipes through `formatPsTable`; writes to stdout; returns 0.
  - [x] `_tui-source.ts` `subscribe(observer)` registers a notification handler with the client; the handler invokes the observer with the inner `entry.event` (not the full notification wrapper).
  - [x] `_tui-source.ts` `sendInput("hi")` calls `client.call("run.send", {runId, message: "hi"})` exactly once.
  - [x] `_tui-source.ts` `detach()` calls the unsubscribe returned from `client.subscribe`.
- Integration tests:
  - [ ] Covered by task 19's "Lifecycle" and "Concurrent runs" scenarios.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every command's `run()` returns a numeric exit code (no `process.exit` calls inside the command — dispatcher decides).
- Mock `DaemonClient` is reusable from task 16's tests.
