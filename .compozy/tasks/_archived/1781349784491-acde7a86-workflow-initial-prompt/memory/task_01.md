# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Domain foundation: optional `initialPrompt` on `RunSnapshot` + `EntryInboundKind`
(`user-request | handoff`) discriminator on the runner's entry-inbound channel so
the entry kickoff can be framed as a user request. DONE — verified green.

## Important Decisions

- Named the inbound channel type `InboundMessage { message; kind }` (exported from
  `runner.ts`); agent-session imports it. Techspec showed it inline; a named type
  keeps the three signatures clean.
- `buildKickoffPrompt` uses an `INBOUND_LABELS` record keyed by kind rather than a
  ternary, so adding kinds later is mechanical.
- `notifyStepBoundary`/`onStepBoundary` kept their `string | null` message param
  unchanged — kind only affects kickoff framing, not boundary persistence.

## Learnings

- `RunnerAgentSessionArgs.inboundMessage` AND `AgentSessionArgs.inboundMessage`
  both had to change to `inbound` (two parallel interfaces, runner.ts + agent-session.ts).
- run-manager `#launchRunner` was the only non-test call site of `runner.run`; its
  retry/resume inbound is now wrapped as `{ message, kind: "handoff" }`. Fresh-start
  caller (line ~306) still passes no inbound — task 02 adds `user-request`.

## Files / Surfaces

- `src/domain/run.ts` — initialPrompt field (snapshot/constructor/create/serialize)
- `src/domain/runner.ts` — EntryInboundKind, InboundMessage, run() signature, handoff kind
- `src/infra/acp/agent-session.ts` — buildKickoffPrompt label-by-kind
- `src/infra/daemon/run-manager.ts` — #launchRunner wraps inbound as handoff
- Tests: run.test.ts, runner.test.ts, agent-session.test.ts, fixture-session-factory.test.ts

## Errors / Corrections

(none)

## Ready for Next Run

Task 02 (daemon wiring): `startRun(..., initialPrompt?)` → `Run.create({initialPrompt})`
+ fresh-start `#launchRunner` should pass `{ message: initialPrompt, kind: "user-request" }`.
The fresh-start `#launchRunner` call (run-manager ~line 306) currently passes no
inbound; that is where the user-request kind gets wired.
