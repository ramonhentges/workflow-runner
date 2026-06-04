---
status: completed
title: Require `ide` in workflow step validation
type: backend
complexity: low
dependencies: []
---

# Task 3: Require `ide` in workflow step validation

## Overview
Make the `ide` field mandatory on every workflow step so agent selection is explicit
and self-documenting. Validation only checks that `ide` is a non-empty string; it does
not check membership in the supported set (that surfaces at the step per ADR-001), so
this task is independent of the profile work.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `validateStep` MUST reject a step whose `ide` is missing or an empty/whitespace string, mirroring the existing `agent`/`model` checks.
- The rejection MUST throw `WorkflowConfigError` with a message of the form `Step '<id>': missing or empty 'ide'`.
- `validateStep` MUST NOT validate `ide` against the supported-agent set (no load-time membership check, per the PRD non-goal).
- Any existing test fixture or sample workflow that omits `ide` MUST be updated to set it so the suite stays green.
</requirements>

## Subtasks
- [x] 3.1 Add the required-`ide` check to `validateStep` alongside the `agent`/`model` checks.
- [x] 3.2 Stop defaulting `ide` to `""` once it is required.
- [x] 3.3 Audit fixtures/sample workflows for any step missing `ide` and fix them.
- [x] 3.4 Add tests for the missing/empty-`ide` rejection and the valid-`ide` acceptance.

## Implementation Details
Modify `src/domain/workflow.ts` (`validateStep`, ~144–166): add a non-empty-string
guard for `s.ide` and set `ide: s.ide` directly. The duplicate-id, missing-agent, and
missing-model checks in the same function are the pattern to follow. Most fixtures
already set `"ide": "opencode"`; confirm none rely on omission. See TechSpec
"Data Models" for the schema change.

### Relevant Files
- `src/domain/workflow.ts` — `validateStep` is where the requirement is enforced.
- `src/domain/workflow.test.ts` — existing step-validation tests to extend.

### Dependent Files
- `workflows/who-is.json` — sample workflow; already sets `ide` (verify).
- `src/infra/mcp/mcp-server.test.ts`, `src/infra/daemon/event-log.test.ts`, and other test fixtures — inline steps must set `ide` (most already do; audit for stragglers).

### Related ADRs
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — `ide` is required; unknown values fail at the step, not at load.

## Deliverables
- `validateStep` enforcing a non-empty `ide`.
- Updated fixtures/sample workflows where needed.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for workflow loading with/without `ide` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A step object with no `ide` key throws `WorkflowConfigError` matching `missing or empty 'ide'`.
  - [x] A step with `ide: ""` (and `ide: "   "`) throws the same error.
  - [x] A step with `ide: "opencode"` validates and the resulting `Step.ide` equals `"opencode"`.
  - [x] An arbitrary non-empty `ide` (e.g. `"made-up"`) passes validation (no load-time membership check).
- Integration tests:
  - [x] `Workflow.load("workflows/who-is.json")` succeeds and every loaded step has a non-empty `ide`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Workflows without an explicit `ide` on every step are rejected at load with a clear message.
- The full existing test suite remains green after fixture updates.
