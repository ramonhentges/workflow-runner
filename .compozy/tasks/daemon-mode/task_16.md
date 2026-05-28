---
status: completed
title: App commands — interaction and daemon (attach, send, doctor, daemon)
type: backend
complexity: medium
dependencies:
  - task_12
  - task_13
  - task_14
---

# Task 16: App commands — interaction and daemon (attach, send, doctor, daemon)

## Overview
Implement the four remaining CLI subcommand entries: `attach`, `send`, `doctor`, and `daemon`. `attach` opens a TUI on a running run; `send` queues a message headlessly; `doctor` prints the daemon health report; `daemon` runs the daemon process in the foreground.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/app/commands/attach.ts`, `send.ts`, `doctor.ts`, `daemon.ts`.
- Each command MUST export `async function run(argv: string[]): Promise<number>`.
- `attach` MUST:
  - Parse optional positional `runId` argument.
  - If no `runId`: call `client.call("run.ps",{})`; if exactly one active run, attach to it; if zero, print `no runs; start one with: workflow-runner start <workflow.json>` to stderr, return 1; if many, print a listing and return 1.
  - Otherwise resolve the prefix client-side or rely on daemon resolution; call `client.call("run.attach",{runId})` and host a local `Tui` over the `_tui-source.ts` adapter from task 15.
  - Exit cleanly when the TUI exits (via `/detach`, Ctrl-C, `/quit`).
- `send` MUST:
  - Parse positional `runId` argument and a positional message OR `-` to read stdin.
  - Call `client.call("run.send", {runId, message})`; exit 0 on success.
  - Map `RUN_NOT_INTERACTIVE` to a clear message on stderr and exit 1.
- `doctor` MUST:
  - Call `client.call("daemon.doctor",{})`; pipe through `formatDoctorReport` (task 13); print to stdout.
  - Exit 0 if all subsystems are OK; exit 1 if any are FAIL; exit 0 with non-zero-on-WARN documented as a non-goal in V1.
- `daemon` MUST:
  - Parse no arguments (other than `--help` handled by dispatcher).
  - Directly invoke `runDaemon({})` from `src/infra/daemon/daemon.ts` (task 11); does NOT call `client.connect()` — this command IS the daemon.
  - Block until the daemon exits (SIGTERM/SIGINT); return exit code from `runDaemon`.
- Each command MUST print clear, actionable messages on errors.
</requirements>

## Subtasks
- [x] 16.1 Implement `attach.ts` including the zero-arg disambiguation behavior.
- [x] 16.2 Implement `send.ts` including the `-`-from-stdin path.
- [x] 16.3 Implement `doctor.ts` calling format + print.
- [x] 16.4 Implement `daemon.ts` directly invoking `runDaemon`.
- [x] 16.5 Write unit tests with the shared mock `DaemonClient` from task 15.

## Implementation Details
Create the four command files. `attach.ts` reuses the `_tui-source.ts` adapter from task 15. `send.ts` reads stdin via `Bun.stdin.text()` when the message arg is `-`. `daemon.ts` is the only command that does not go through the client — it spins up the daemon directly. Note that `attach` with no `runId` does NOT call `parseIdentifier` itself; it delegates to the daemon's `_resolve-run.ts` (task 09) by sending the prefix verbatim, which surfaces `AMBIGUOUS_PREFIX` errors that `attach` then maps to the multi-run listing.

### Relevant Files
- `src/infra/client/client.ts` (task 12) — for everything except `daemon`.
- `src/infra/client/format.ts` (task 13) — `formatDoctorReport`.
- `src/infra/tui/tui.ts` (task 14) — `Tui.create()` + `attachSource()`.
- `src/infra/daemon/daemon.ts` (task 11) — `runDaemon` invoked by the `daemon` command.
- `src/app/commands/_tui-source.ts` (task 15) — TUI source adapter shared with `start`.

### Dependent Files
- `src/app/main.ts` (task 17) — dispatches argv to these `run()` functions.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — attach zero-arg behavior, doctor exit codes.

## Deliverables
- Four command files (`attach.ts`, `send.ts`, `doctor.ts`, `daemon.ts`).
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `attach.run(["abc"])` invokes `client.call("run.attach",{runId:"abc"})`; hosts a Tui; returns 0 on detach.
  - [ ] `attach.run([])` with `run.ps` returning exactly one active run: invokes `run.attach` for that run's id; returns 0.
  - [ ] `attach.run([])` with `run.ps` returning zero active runs: prints the actionable message; returns 1.
  - [ ] `attach.run([])` with `run.ps` returning three active runs: prints a listing of the three runs; returns 1; does NOT call `run.attach`.
  - [ ] `attach.run(["abc"])` with daemon error `AMBIGUOUS_PREFIX` and `data.candidates`: prints "ambiguous run prefix 'abc'; candidates: ..." with each candidate's id; returns 1.
  - [ ] `send.run(["abc", "hello"])` invokes `client.call("run.send",{runId:"abc",message:"hello"})`; returns 0.
  - [ ] `send.run(["abc", "-"])` with stdin "multi\nline\n": invokes `run.send` with `"multi\nline\n"`; returns 0.
  - [ ] `send.run(["abc", "hi"])` with daemon error `RUN_NOT_INTERACTIVE`: prints "cannot send to run 'abc': current step is autonomous"; returns 1.
  - [ ] `doctor.run([])` invokes `daemon.doctor`; pipes through `formatDoctorReport`; returns 0 when all OK.
  - [ ] `doctor.run([])` returns 1 when any subsystem reports FAIL.
  - [ ] `daemon.run([])` directly invokes `runDaemon` (mock the function); returns the value `runDaemon` resolved with.
- Integration tests:
  - [ ] Covered by task 19's "Attach/detach", "Auto-spawn", and "stop semantics" scenarios.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `daemon.run` is the only command that does not call `client.connect()`.
- Every command returns a numeric exit code; no `process.exit` inside command bodies.
