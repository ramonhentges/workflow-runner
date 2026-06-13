---
status: completed
title: Daemon — thread initialPrompt + kind through RunManager and run.start RPC
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 2: Daemon — thread initialPrompt + kind through RunManager and run.start RPC

## Overview
Carry the optional initial prompt from the `run.start` RPC into the run: persist it
on the run snapshot and deliver it to the entry step with `kind: "user-request"`,
while the retry path keeps delivering its inbound message with `kind: "handoff"`.
This is the server-side hub that both the HTTP API (task 03) and the CLI (task 04)
feed into.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `initialPrompt?: string` to the `run.start` RPC params in
  the protocol type.
- MUST forward `initialPrompt` from the `run.start` handler into
  `RunManager.startRun`.
- MUST make `RunManager.startRun` accept `initialPrompt?`, pass it to `Run.create`,
  and deliver it to the entry step via `#launchRunner` with `kind: "user-request"`.
- MUST make the retry path (`retryStep` → `#launchRunner`) deliver its inbound
  message with `kind: "handoff"`.
- MUST omit `initialPrompt` end-to-end when not supplied, preserving today's
  behavior exactly.
</requirements>

## Subtasks
- [x] 2.1 Add optional `initialPrompt` to the `run.start` params type in the protocol.
- [x] 2.2 Forward `initialPrompt` through the `run.start` handler to `startRun`.
- [x] 2.3 Extend `startRun` to accept `initialPrompt`, pass it to `Run.create`, and launch the entry step as `user-request`.
- [x] 2.4 Update the retry launch path to pass `kind: "handoff"`.
- [x] 2.5 Add unit/integration tests covering prompt persistence and per-path kind.

## Implementation Details
See TechSpec "API Endpoints" and "Impact Analysis". The entry inbound now uses the
`{message, kind}` shape from task 01. `#launchRunner` already forwards an entry
inbound to `runner.run`; extend it to carry the kind. The fresh-start call passes
`user-request`; `retryStep` passes `handoff`. Do not duplicate the protocol type
here — reference the TechSpec.

### Relevant Files
- `src/infra/daemon/protocol.ts` — `RpcMethods["run.start"].params`; add optional `initialPrompt`.
- `src/infra/daemon/handlers/run-start.ts` — pass `params.initialPrompt` to `startRun`.
- `src/infra/daemon/run-manager.ts` — `startRun` signature, `Run.create` call, `#launchRunner` kind argument, `retryStep` launch call.

### Dependent Files
- `src/app/api/routes/start-run.ts` — HTTP route that calls `startRun` (task 03).
- `src/app/commands/start.ts` — CLI that calls `run.start` (task 04).
- `src/infra/daemon/run-store.ts` — persists the snapshot including `initialPrompt`.

### Related ADRs
- [ADR-002: Inbound-message kind discriminator for kickoff framing](../adrs/adr-002.md) — fresh-start vs retry kind selection.
- [ADR-003: Dedicated initialPrompt field on the run snapshot](../adrs/adr-003.md) — persistence of the prompt.

## Deliverables
- `run.start` params and handler carrying optional `initialPrompt`.
- `startRun` persisting the prompt and launching the entry step as `user-request`.
- Retry path launching as `handoff`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for prompt persistence and entry-step framing **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `run.start` handler forwards a provided `initialPrompt` to `startRun`.
  - [x] `run.start` handler omits `initialPrompt` when absent (no `undefined` leak that changes behavior).
- Integration tests:
  - [x] `startRun(path, cwd, undefined, "review PR #42")` persists `initialPrompt` on the snapshot and the entry step's recorded kickoff contains the user-request label.
  - [x] A run started without a prompt has no `initialPrompt` on its snapshot and identical kickoff text to before.
  - [x] `retryStep` re-enters its step with a `handoff`-framed inbound (no user-request label).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A prompt supplied to `run.start` is persisted and reaches the first agent as a user request.
- Retry framing and no-prompt behavior are unchanged.
