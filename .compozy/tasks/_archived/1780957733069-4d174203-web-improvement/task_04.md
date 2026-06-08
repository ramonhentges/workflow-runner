---
status: completed
title: Dashboard status summary cards + URL filter
type: frontend
complexity: medium
dependencies:
  - task_01
  - task_03
---

# Task 4: Dashboard status summary cards + URL filter

## Overview
Add five status summary cards (running / completed / failed / crashed / aborted) above the runs list, derived client-side from the existing runs poll, with the Failed card emphasized when non-zero. Clicking a card filters the runs list via a typed URL search param so the filtered view is shareable and survives reload (ADR-003).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render five separate cards — Running, Completed, Failed, Crashed, Aborted — with counts derived client-side from the existing `useRuns` poll (no new endpoint).
- MUST visually emphasize the Failed card when its count is non-zero.
- MUST make each card clickable to filter the runs list to that status.
- MUST store the active filter as a typed, optional `status` search param on the dashboard (index) route via `validateSearch`, coercing unknown values to "no filter" (ADR-003).
- MUST have the runs list read the `status` param and filter the already-polled runs array (no extra fetch).
- MUST allow clicking the active card again to clear the filter.
- MUST add the shadcn `card` primitive via the CLI if not already present.
- MUST use `StatusBadge` (or its tokens) so card status colors match the list.
</requirements>

## Subtasks
- [x] 4.1 Add `validateSearch` for an optional `status` param on the index route, whitelisting the five `RunStatus` values.
- [x] 4.2 Build `StatusSummaryCards` computing counts from polled runs.
- [x] 4.3 Wire card clicks to navigate the `status` search param (toggle off on re-click).
- [x] 4.4 Emphasize the Failed card when count > 0.
- [x] 4.5 Have `RunsTable` filter its rows by the active `status` param.
- [x] 4.6 Test the count derivation, emphasis, navigation, and filtering.

## Implementation Details
Create `web/src/features/dashboard/StatusSummaryCards.tsx`; add `validateSearch` to `indexRoute` in `web/src/router.tsx`; have `RunsTable.tsx` consume the route search param to filter. See TechSpec "Core Interfaces" (`parseStatus`/`validateSearch`), "Data Models" (client-side count reduction), and ADR-003.

### Relevant Files
- `web/src/router.tsx` — `indexRoute` gains `validateSearch`; existing `newWorkflowRoute` shows the `validateSearch` precedent.
- `web/src/features/dashboard/RunsTable.tsx` — reads the `status` param to filter rows (migrated in Task 3).
- `web/src/features/dashboard/useRuns.ts` — the unchanged 2s poll feeding counts and rows.
- `web/src/lib/api/types.ts` — `RunStatus` union the param parser whitelists.
- `web/src/components/status-badge.tsx` — shared status presentation for cards.

### Dependent Files
- `web/src/features/dashboard/RunsTable.test.tsx` — gains filtered-view assertions.
- `web/src/__tests__/routing.test.tsx` — index route now parses a search param.

### Related ADRs
- [ADR-003: Drive the dashboard status filter from a typed URL search param](../adrs/adr-003.md) — Filter lives in `?status=` on the index route; no new data fetch.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — Five separate cards; Failed emphasized; click-to-filter.

## Deliverables
- `web/src/features/dashboard/StatusSummaryCards.tsx` with five cards and click-to-filter.
- `validateSearch` for `status` on the index route.
- `RunsTable` filtering by the active `status` param.
- `card` shadcn primitive present under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for card-click → filtered list **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Counts equal the number of runs per status for a mixed-status runs array.
  - [x] Failed card receives the emphasis treatment when its count is > 0 and not when it is 0.
  - [x] Clicking the Failed card navigates to `?status=failed`.
  - [x] Clicking the already-active card clears the `status` param.
  - [x] `validateSearch` coerces an unknown `status` value (e.g. `?status=bogus`) to no filter.
- Integration tests:
  - [x] With MSW-mocked runs spanning all statuses, clicking the Failed card filters the rendered rows to failed runs only; clearing restores all rows.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Five cards answer "what's running / what failed?" at a glance (PRD 5-second rule) and reach a failing run in ≤2 clicks.
- The filtered view is reflected in the URL and survives reload.
