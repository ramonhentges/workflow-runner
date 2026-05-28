---
status: completed
title: Runner onStepBoundary callback
type: refactor
complexity: medium
dependencies:
  - task_01
---

# Task 03: Runner onStepBoundary callback

## Overview
Extend the existing `Runner` to accept an `onStepBoundary(visited, currentStepId)` callback that the daemon will use to persist `meta.json` between step transitions. This is the load-bearing change that guarantees crash recovery sees the correct `currentStepId`: the callback must complete (durable write returned) before the next step's `banner` event is emitted.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `onStepBoundary?: (visited: StepId[], nextStepId: StepId | null) => Promise<void>` to `RunnerOptions`.
- MUST call (and await) the callback in `Runner.run()` between completing a step (after `session.dispose()` and `tools.resetStep()`) and emitting the next iteration's `banner` event.
- MUST also call the callback once before the first `banner` (so initial `currentStepId` is persisted) and once after the final outcome (so terminal status is persisted before the `summary` event).
- MUST NOT change behavior for existing callers that omit the callback — existing `runner.test.ts` tests pass without modification beyond compile-time type adjustments.
- MUST swallow no errors from the callback: a thrown error from `onStepBoundary` must propagate and cause the Runner to record a `failure` outcome with the error message.
- MUST add at least one new test asserting strict ordering: `onStepBoundary` resolved → `banner` event emitted, in that order.
</requirements>

## Subtasks
- [x] 3.1 Add the new optional field to `RunnerOptions` and store it as a private field on `Runner`.
- [x] 3.2 Call the callback before the first `banner` (initial position) inside `run()`.
- [x] 3.3 Call the callback between step resolution and next iteration's `banner`, awaiting completion.
- [x] 3.4 Call the callback once after the final outcome (terminal step) before the `summary` event.
- [x] 3.5 Add the failure-path: if the callback throws, set `failure = {failedStep, reason: callback error message}` and break the loop.
- [x] 3.6 Update or add tests verifying the await-ordering contract and the throw-handling behavior.

## Implementation Details
Modify `src/domain/runner.ts` in place. The existing `RunnerOptions` interface is at the top of the file; add the new optional field there. The call sites inside `run()`: one before the first iteration (line ~140 in current code, just before the `while (true)` body's first `emit(banner)`), one inside the outcome-handling block (after `resetStep()` and before `currentStepId = stepOutcome.nextStep`), and one after the loop breaks but before `this.emit({type: "summary", summary})`.

The exact location of the inside-loop callback must be: after `this.#tools.resetStep()` (line 182 in current `runner.ts`) and after computing `currentStepId` for the next iteration but *before* the loop's next pass emits the new `banner` (lines 162-164 in current code).

### Relevant Files
- `src/domain/runner.ts` — the file being modified; current `run()` loop is at lines 119-219.
- `src/domain/runner.test.ts` — existing test file; must continue to pass.
- `src/domain/run.ts` (task 01) — provides the `Run` aggregate whose `markStepEntered`/`markCompleted` etc. the daemon will call inside the callback.

### Dependent Files
- `src/infra/daemon/run-manager.ts` (task 08) — supplies the callback when constructing the per-run `Runner`; the callback writes `meta.json` via the `RunStore`.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — establishes the fsync-before-banner contract that this callback enforces.

## Deliverables
- Modified `src/domain/runner.ts` with the new `onStepBoundary` option and three call sites.
- Updated/added tests in `src/domain/runner.test.ts` covering the await-ordering and throw-propagation.
- No new dependencies.
- Existing tests pass unchanged.
- Unit tests with 80%+ coverage on the new code paths **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `runner.run()` with no `onStepBoundary` behaves identically to today (existing tests still pass).
  - [x] `onStepBoundary` is invoked exactly `N + 1` times for a workflow that visits `N` steps and finishes (once before the first banner, once between each pair of consecutive steps, once after the terminal outcome).
  - [x] Ordering: a test observer records the sequence of events and callback calls; assert that for every pair of consecutive steps, the callback resolution timestamp is less than the next `banner` event timestamp.
  - [x] If the callback throws on the first call, `run()` resolves with `failure.failedStep === entryStepId` and `failure.reason` contains the thrown error's message.
  - [x] If the callback throws between two steps, `run()` resolves with `failure.failedStep === <step that just finished>` and the failure reason includes the thrown error's message.
  - [x] If the callback returns a rejected promise (vs throwing synchronously), the failure path triggers identically.
  - [x] The callback receives the correct `visited` array (snapshot at call time, not a live reference) and the correct `nextStepId` (the id of the step about to enter, or `null` for the post-terminal call).
- Integration tests:
  - [ ] Covered by task 19's "Daemon-restart discovery" scenario.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Existing `src/domain/runner.test.ts` tests pass without behavioral changes.
- `bun run typecheck` passes.
