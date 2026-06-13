---
status: completed
title: Domain — entry-inbound kind + initialPrompt snapshot field
type: backend
complexity: medium
dependencies: []
---

# Task 1: Domain — entry-inbound kind + initialPrompt snapshot field

## Overview
Establish the domain foundation for the feature: add an optional `initialPrompt`
to the run snapshot so a run can carry the prompt it was started with, and add an
entry-inbound `kind` discriminator so the first step's kickoff can be framed as a
user request without disturbing the retry path's "Context from previous step"
wording. Every later task depends on these domain changes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `initialPrompt?: string` to `RunSnapshot`, accepted by
  `Run.create` and serialized by `snapshot()` ONLY when present (mirroring the
  existing conditional handling of `branch`/`cwd`).
- MUST round-trip `initialPrompt` through `Run.create` → `snapshot()` →
  `Run.fromSnapshot` without loss, and omit it entirely when not supplied.
- MUST introduce an `EntryInboundKind` type with values `"user-request"` and
  `"handoff"` and carry it alongside the entry-step inbound message in `runner.run`.
- MUST make `buildKickoffPrompt` select the framing label from the kind:
  `user-request` → "User request for this run:", `handoff` → "Context from
  previous step:" (the existing wording, unchanged).
- MUST frame inter-step handoffs produced inside the runner loop as `handoff`.
- MUST preserve byte-for-byte current behavior when there is no inbound message
  (no prompt, non-retry start).
</requirements>

## Subtasks
- [x] 1.1 Add `initialPrompt?` to `RunSnapshot`, `Run.create` args, constructor, and conditional serialization in `snapshot()`.
- [x] 1.2 Define `EntryInboundKind` and change the entry-inbound parameter of `runner.run` to carry `{ message, kind }` (nullable).
- [x] 1.3 Update `buildKickoffPrompt` to choose the label from the kind, leaving the no-inbound output identical to today.
- [x] 1.4 Ensure inter-step handoffs in the runner loop pass `kind: "handoff"`.
- [x] 1.5 Add/extend unit tests for snapshot round-trip and per-kind kickoff framing.

## Implementation Details
Implements ADR-002 (kind discriminator) and ADR-003 (dedicated snapshot field).
See TechSpec "Core Interfaces" and "Data Models" for the exact type shapes; do not
duplicate them here. Follow the conditional-serialization style already used for
`branch`/`cwd` in `Run.snapshot()`. The entry-inbound value flows from callers in
task 02; this task only defines the domain contract and framing.

### Relevant Files
- `src/domain/run.ts` — `RunSnapshot`, `Run.create`, constructor, `snapshot()`; add the optional field.
- `src/domain/runner.ts` — `run()` entry-inbound channel; add `EntryInboundKind` and `{message, kind}`; set `handoff` kind for inter-step transitions.
- `src/infra/acp/agent-session.ts` — `buildKickoffPrompt` label selection by kind.

### Dependent Files
- `src/infra/daemon/run-manager.ts` — will call `Run.create` with `initialPrompt` and `runner.run` with a kind (task 02).
- `src/infra/daemon/run-store.ts` — round-trips the snapshot; gains the field transparently.

### Related ADRs
- [ADR-002: Inbound-message kind discriminator for kickoff framing](../adrs/adr-002.md) — defines the kind values and framing labels.
- [ADR-003: Dedicated initialPrompt field on the run snapshot](../adrs/adr-003.md) — defines the snapshot field and serialization rule.

## Deliverables
- `RunSnapshot.initialPrompt?` with create/constructor/snapshot support, conditionally serialized.
- `EntryInboundKind` type and a `{message, kind}` entry-inbound channel on `runner.run`.
- `buildKickoffPrompt` framing by kind, with unchanged no-inbound output.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for kickoff framing per kind via the runner loop **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `Run.create({ initialPrompt: "x" })` → `snapshot().initialPrompt === "x"`, and `fromSnapshot` restores it.
  - [x] `Run.create({})` → `snapshot()` has no `initialPrompt` key (not `undefined` value).
  - [x] `buildKickoffPrompt(step, { message: "m", kind: "user-request" })` contains "User request for this run: m" and not "Context from previous step".
  - [x] `buildKickoffPrompt(step, { message: "m", kind: "handoff" })` contains "Context from previous step: m".
  - [x] `buildKickoffPrompt(step, null)` returns the exact string produced today (mode instructions + description, no inbound line).
- Integration tests:
  - [x] Runner entered at the first step with `{ kind: "user-request" }` records an entry kickoff containing the user-request label; a subsequent step receives a `handoff`-framed kickoff.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No-prompt, non-retry runs produce identical kickoff text and snapshots to before this change.
- `initialPrompt` and the entry-inbound `kind` are available for daemon wiring (task 02).
