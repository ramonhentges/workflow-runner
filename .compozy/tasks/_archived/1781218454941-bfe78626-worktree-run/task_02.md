---
status: completed
title: Add worktreePath and branch to Run and RunSnapshot
type: backend
complexity: low
dependencies: []
---

# Task 2: Add worktreePath and branch to Run and RunSnapshot

## Overview
Extend the `Run` aggregate and `RunSnapshot` with two optional fields, `worktreePath` and `branch`, so an isolated run's location and branch persist and round-trip through snapshots. Keeping `cwd` as the repository root and adding these flat optional fields leaves the non-isolated path byte-for-byte unchanged.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add optional `worktreePath?: string` and `branch?: string` to `RunSnapshot` and the `Run` aggregate.
- `Run.create` MUST accept the two new optional fields alongside the existing `cwd`.
- `snapshot()` MUST emit `worktreePath`/`branch` only when set, matching the existing conditional handling of `cwd` and `endReason`.
- `Run.fromSnapshot` MUST preserve both fields, so restart discovery and retry carry them forward unchanged.
- Non-isolated runs (no branch) MUST produce snapshots identical in shape to today.
</requirements>

## Subtasks
- [x] 2.1 Add the two optional fields to the `RunSnapshot` interface.
- [x] 2.2 Add matching private fields and constructor wiring to `Run`.
- [x] 2.3 Accept the fields in `Run.create`.
- [x] 2.4 Emit them conditionally from `snapshot()` and restore them in `fromSnapshot`.
- [x] 2.5 Cover round-trip and omission behavior with unit tests.

## Implementation Details
Modify `src/domain/run.ts` only. Follow the existing pattern where `cwd` and `endReason` are added to the emitted snapshot only when defined. The effective working directory is computed downstream as `worktreePath ?? cwd` (task_03), so this task adds storage and round-trip only. See TechSpec "Data Models" and ADR-004.

### Relevant Files
- `src/domain/run.ts` — `RunSnapshot` interface, `Run` class, `create`, `snapshot`, `fromSnapshot`.
- `src/domain/run.test.ts` — existing snapshot round-trip tests to extend.

### Dependent Files
- `src/infra/daemon/run-manager.ts` — sets the new fields when provisioning an isolated run (task_03).
- `src/infra/daemon/protocol.ts` — `RunListEntry`/`RunSnapshot` re-export consumed downstream (task_04).

### Related ADRs
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Defines exactly these two flat optional fields and the `worktreePath ?? cwd` rule.

## Deliverables
- `RunSnapshot` and `Run` carrying optional `worktreePath` and `branch`.
- Conditional emission from `snapshot()` and restoration in `fromSnapshot`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests verifying snapshot persistence round-trip via the run store **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `Run` created with `worktreePath` and `branch` emits both in `snapshot()`.
  - [x] A `Run` created without them omits both keys entirely (snapshot shape matches the non-isolated case).
  - [x] `fromSnapshot` → `snapshot` round-trip preserves `worktreePath` and `branch`.
  - [x] `fromSnapshot` round-trip with the fields absent stays absent (no `undefined` keys introduced).
- Integration tests:
  - [x] A snapshot persisted with `worktreePath`/`branch` and re-read from the run store retains both values.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Non-isolated run snapshots are unchanged in shape
- Both fields survive a `fromSnapshot`→`snapshot` round-trip
