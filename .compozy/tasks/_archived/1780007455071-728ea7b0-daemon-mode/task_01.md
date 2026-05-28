---
status: completed
title: Domain Run aggregate
type: backend
complexity: low
dependencies: []
---

# Task 01: Domain Run aggregate

## Overview
Introduce a pure-domain `Run` aggregate that represents a single workflow execution: id, slug, workflow path, status, current/visited step ids, kickoff prompts per step, and timing metadata. This is the load-bearing domain object that every other daemon component depends on; getting its status transitions right is what makes crash recovery and `retry-step` correct.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/domain/run.ts` with zero imports from `src/infra/` or `src/app/` (hexagonal rule).
- MUST expose a `Run` class with the field shape described in TechSpec → Data Models → `meta.json schema`.
- MUST expose a `RunSnapshot` plain-object type for serialization and a round-trip pair (`Run.fromSnapshot(snap)` and `Run#snapshot()`).
- MUST expose status-transition methods: `markStepEntered(stepId, kickoffPrompt)`, `markCompleted()`, `markFailed(reason)`, `markCrashed(reason)`, `markAborted()`.
- MUST reject illegal status transitions (e.g., `markCompleted()` from `aborted` throws).
- MUST expose `eligibleForRetry(): boolean` returning true only for `crashed`, `failed`, or `aborted`.
- MUST brand `RunId` and `RunSlug` as opaque string types in the same pattern as `SessionId`/`StepToken` in `src/domain/ids.ts`.
- MUST set `endedAt` exactly when a terminal status is reached (`completed`/`failed`/`crashed`/`aborted`), never before.
</requirements>

## Subtasks
- [x] 1.1 Add branded `RunId` and `RunSlug` types alongside the existing branded ids (`src/domain/ids.ts` or a new sibling).
- [x] 1.2 Define `RunSnapshot` plain-object type and `RunStatus` literal-union type.
- [x] 1.3 Implement `Run` class with field initialization, `snapshot()`, `fromSnapshot()`, and the five mutator methods.
- [x] 1.4 Encode the legal status-transition state machine in one place (a private `assertTransition(from, to)` or equivalent) and use it from every mutator.
- [x] 1.5 Write unit tests covering the snapshot round-trip, all legal transitions, every rejected illegal transition, and `eligibleForRetry()` behavior.

## Implementation Details
Create `src/domain/run.ts` as a sibling of the existing `runner.ts`/`workflow.ts`/`outcome.ts`. See TechSpec → "Core Interfaces" for the public `Run` shape and "Data Models" for the snapshot field types. The branded-id pattern is already established in `src/domain/ids.ts`; mirror it for `RunId`/`RunSlug` (either inline in `ids.ts` or in a sibling file — pick one, do not duplicate the branding helper). Status-transition tables: legal targets from `running` are `{completed, failed, crashed, aborted}`; terminal statuses have no legal outgoing transitions.

### Relevant Files
- `src/domain/ids.ts` — establishes the branded-id pattern (`SessionId`, `StepToken`); reuse it for `RunId`/`RunSlug`.
- `src/domain/workflow.ts` — example of a pure-domain value object with `fromJson` and zero I/O imports.
- `src/domain/runner.ts` — defines `RunSummary` and uses branded ids; reference for code style.

### Dependent Files
- `src/domain/run-id.ts` (task 02) — will import `RunId`/`RunSlug` from this task.
- `src/infra/daemon/run-store.ts` (task 04) — will serialize/deserialize `RunSnapshot`.
- `src/infra/daemon/run-manager.ts` (task 08) — will own `Run` instances per active run.

### Related ADRs
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — places `Run` in `domain/` because status transitions are pure business logic.
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines what statuses exist (running/completed/failed/crashed/aborted) and the retry-eligibility rule.

## Deliverables
- `src/domain/run.ts` with the `Run` class, `RunSnapshot`, `RunStatus`, and branded id types.
- Status-transition state machine encoded in one place inside the class.
- Unit tests with 80%+ coverage **(REQUIRED)**
- All `bun test` runs pass with no new warnings **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `Run.create({id, slug, workflowPath})` produces a snapshot with `status === "running"`, empty `visitedStepIds`, empty `kickoffPrompts`, `startedAt > 0`, `endedAt === null`.
  - [x] `snapshot()` then `fromSnapshot()` round-trips to an equal `Run` (deep-equal on snapshots).
  - [x] `markStepEntered("step-1", "prompt-A")` then `snapshot()` shows `currentStepId === "step-1"`, `visitedStepIds` contains `"step-1"`, `kickoffPrompts["step-1"] === "prompt-A"`.
  - [x] `markStepEntered` twice with different steps appends to `visitedStepIds` in order, preserves all kickoff prompts.
  - [x] `markCompleted()` transitions status to `completed`, sets `endedAt` to a number greater than `startedAt`.
  - [x] `markFailed("reason text")` transitions to `failed`, sets `endedAt`, populates `endReason` with `"reason text"`.
  - [x] `markCrashed("daemon restart")` transitions to `crashed`, sets `endedAt`, `endReason === "daemon restart"`.
  - [x] `markAborted()` transitions to `aborted`, sets `endedAt`.
  - [x] `markCompleted()` called twice throws an `Error` whose message names the source status `completed`.
  - [x] `markStepEntered()` called after `markCompleted()` throws.
  - [x] `eligibleForRetry()` returns true for status in `{crashed, failed, aborted}`, false for status in `{running, completed}`.
  - [x] `fromSnapshot` with `status: "running"` produces a `Run` whose mutators are still callable.
  - [x] `fromSnapshot` with `status: "completed"` produces a `Run` whose `markStepEntered` throws.
- Integration tests:
  - [ ] None for this task — the `Run` aggregate is pure domain. Integration coverage is provided by task 19.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `src/domain/run.ts` has zero imports from `src/infra/` or `src/app/`.
- `bun run typecheck` passes with no errors related to the new module.
