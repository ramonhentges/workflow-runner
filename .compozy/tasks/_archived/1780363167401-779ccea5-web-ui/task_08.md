---
status: completed
title: "Web: Dashboard (Query hooks + runs table)"
type: frontend
complexity: medium
dependencies:
    - task_05
    - task_07
---

# Task 08: Web: Dashboard (Query hooks + runs table)

## Overview
Build the run dashboard — the app's home — listing active and recent runs with auto-updating status, scoped to the active cwd. It uses TanStack Query hooks over the HTTP client and a shadcn table, with an "all runs" toggle and per-row links into the focused run view.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- A `useRuns` query hook MUST fetch `GET /runs` filtered by the active cwd (`?cwd=`) and honor an "all runs" toggle (`?all=true`).
- The query MUST auto-refresh (background refetch/polling) so statuses stay current without manual reload.
- The table MUST show slug/id, workflow, status, current step, started/ended time, and attached count, with clear visual treatment per `RunStatus`.
- Each row MUST link to the focused run route for that run.
- Empty states MUST be shown for "no active cwd" and "no runs".

## Subtasks
- [x] 08.1 Implement the `useRuns` query hook keyed by `{ cwd, all }`, reading the active cwd from the store.
- [x] 08.2 Configure background refetch/polling for liveness.
- [x] 08.3 Build the runs table with status styling and the documented columns.
- [x] 08.4 Add the "all runs" toggle wired to the query.
- [x] 08.5 Add row links to the run route and the empty states.

## Implementation Details
Implement `web/src/features/dashboard/` per TechSpec "API Endpoints" (`GET /runs?cwd=&all=`) and "Component Overview", and ADR-005. Use the HTTP client and types from task_05 and the active cwd from task_07's store. Routing targets are finalized in task_11; here, rows link via the router's typed navigation to `/runs/$runId`.

### Relevant Files
- `web/src/features/dashboard/useRuns.ts` — Query hook (new).
- `web/src/features/dashboard/RunsTable.tsx` — table component (new).
- `web/src/lib/api/client.ts` — `listRuns` (from task_05).
- `web/src/stores/cwd-store.ts` — active cwd (from task_07).

### Dependent Files
- `web/src/router.tsx` (task_11) — mounts the dashboard at `/` and defines `/runs/$runId`.

### Related ADRs
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — TanStack Query owns this server state.

## Deliverables
- `useRuns` query hook with cwd/all parameters and background refresh.
- Runs table with status styling, columns, and row links.
- Empty states for no-cwd and no-runs.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests with MSW-mocked `/runs` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `useRuns` issues `GET /runs?cwd=<active>` and re-issues with `&all=true` when the toggle is on (assert request URLs via MSW).
  - [x] The table renders distinct styling for `running` vs `failed` vs `completed` rows.
  - [x] With no active cwd, the no-cwd empty state renders instead of the table.
- Integration tests:
  - [x] With MSW returning two runs, the table shows both rows with workflow, status, and current step (RTL).
  - [x] Clicking a row navigates to `/runs/<id>` (router test harness).
  - [x] An empty `/runs` response renders the no-runs empty state.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The dashboard lists cwd-scoped runs with live-updating status and an all-runs toggle.
- Rows navigate to the focused run view.
