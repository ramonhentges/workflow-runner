---
status: completed
title: Runs list migration to shadcn Table
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 3: Runs list migration to shadcn Table

## Overview
Migrate the dashboard runs table to shadcn `Table` primitives with GitHub-Actions-style icon-first rows (status → workflow → current step → started → duration), rendering status through the shared `StatusBadge`. This turns the bare hand-rolled table into a scannable, consistent run list while preserving every test contract.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST migrate `web/src/features/dashboard/RunsTable.tsx` to shadcn `Table` primitives.
- MUST render each row icon-first using `StatusBadge` for status, in column order status → workflow → current step → started → duration.
- MUST derive and display run duration in-view from `startedAt`/`endedAt` (no new data field, no new endpoint).
- MUST NOT add an IDE column (deferred to V2 per ADR-002).
- MUST preserve `run-row-${id}` and `data-status` row attributes, the `getByRole('table')` contract, the `All runs` toggle with `aria-pressed`, and the `loading-state`/`error-state`/`no-runs-state`/`no-cwd-state` test identifiers.
- MUST continue to source rows from the existing `useRuns` 2s poll.
- MUST add the shadcn `table` primitive via the CLI if not already present.
</requirements>

## Subtasks
- [x] 3.1 Add the shadcn `table` primitive via the CLI (if absent).
- [x] 3.2 Rebuild the runs table with shadcn `Table`, icon-first rows, and the new column order.
- [x] 3.3 Replace the `statusClass()` string logic with `StatusBadge`.
- [x] 3.4 Compute and render duration from `startedAt`/`endedAt`.
- [x] 3.5 Carry forward all row/state test identifiers, the table role, and the `All runs` `aria-pressed` toggle.
- [x] 3.6 Update `RunsTable.test.tsx` to the new structure while keeping existing assertions valid.

## Implementation Details
Modify `web/src/features/dashboard/RunsTable.tsx`; remove its local `statusClass()` in favor of `StatusBadge` (Task 1). The list-filter hook for status arrives in Task 4 — this task keeps the existing `All runs` toggle behavior. See TechSpec "Impact Analysis" (`RunsTable`) and "System Architecture" (Dashboard).

### Relevant Files
- `web/src/features/dashboard/RunsTable.tsx` — the component migrated here (currently a hand-rolled `<table>` with `statusClass()`).
- `web/src/features/dashboard/useRuns.ts` — unchanged data source (2s `refetchInterval`).
- `web/src/components/status-badge.tsx` — status rendering (from Task 1).
- `web/src/lib/api/types.ts` — `RunSummary` fields used for columns/duration.
- `web/src/components/ui/` — `table` primitive output location.

### Dependent Files
- `web/src/features/dashboard/RunsTable.test.tsx` — assertions on `run-row-${id}`, table role, `aria-pressed`, state testids.
- `web/src/features/dashboard/StatusSummaryCards.tsx` — Task 4 filters this list via URL param.

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — Table migration carries every `data-testid`/role forward.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — No IDE column in V1.

## Deliverables
- `RunsTable` rebuilt on shadcn `Table` with icon-first rows and duration column.
- `table` shadcn primitive present under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the runs list rendering from polled data **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Rows render with `run-row-${id}` and `data-status` matching each run's status.
  - [x] Status cell renders a `StatusBadge` (not a raw color-class span).
  - [x] Duration renders from `startedAt`/`endedAt` for a completed run, and as in-progress/`—` for a running/unfinished run.
  - [x] `getByRole('table')` resolves; column headers appear in order status → workflow → current step → started → duration.
  - [x] `All runs` toggle flips `aria-pressed` and re-queries.
  - [x] `no-cwd-state`, `loading-state`, `error-state`, and `no-runs-state` each render under their respective conditions.
- Integration tests:
  - [x] With MSW-mocked `listRuns` returning mixed statuses, the table renders one badge-bearing row per run.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Runs list is a shadcn `Table` with icon-first, GitHub-Actions-style rows and no IDE column.
- Every prior `RunsTable` test selector still resolves.
