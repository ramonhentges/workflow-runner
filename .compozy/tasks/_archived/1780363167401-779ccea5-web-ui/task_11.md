---
status: completed
title: "Web: Routing + app shell composition"
type: frontend
complexity: medium
dependencies:
    - task_07
    - task_08
    - task_09
    - task_10
---

# Task 11: Web: Routing + app shell composition

## Overview
Compose the finished features into the application: a persistent app shell hosting the cwd switcher and navigation, with TanStack Router routes for the dashboard (`/`), start-run (`/start`), and the focused run (`/runs/$runId`). This wires the operate loop end-to-end so a user can move from cwd → dashboard → start → live run seamlessly.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The router MUST define routes: `/` (dashboard), `/start` (start-run flow), and `/runs/$runId` (focused run view), replacing the task_04 placeholder.
- A persistent app shell MUST host the cwd switcher and a navigation affordance to the dashboard and start-run, present across routes.
- The `/runs/$runId` route MUST pass the `runId` param into the run view; leaving the route MUST close the live socket (no multi-attach, per ADR-001).
- A start action MUST be reachable from the shell/dashboard; a successful start MUST land on `/runs/$runId` for the new run.
- An unknown route or unknown run id MUST render a sensible not-found state.

## Subtasks
- [x] 11.1 Replace the placeholder route tree with the dashboard, start-run, and run routes.
- [x] 11.2 Build the app shell hosting the cwd switcher and primary navigation.
- [x] 11.3 Wire `/runs/$runId` to pass the param and ensure socket teardown on unmount/route change.
- [x] 11.4 Add a not-found route/state.
- [x] 11.5 Verify the full navigation loop with integration tests.

## Implementation Details
Finalize `web/src/router.tsx` and the shell layout per TechSpec "Component Overview" and ADR-001 (dashboard + one focused run; navigating away ends the stream). Mount the cwd switcher (task_07), dashboard (task_08), start-run (task_09), and run view (task_10). Rely on TanStack Router's lifecycle so unmounting the run route triggers the task_06 client's `close()`.

### Relevant Files
- `web/src/router.tsx` — route tree (finalized; new routes replace the placeholder).
- `web/src/app/AppShell.tsx` — persistent shell + nav (new).
- `web/src/features/cwd/CwdSwitcher.tsx` — mounted in the shell (from task_07).
- `web/src/features/dashboard/RunsTable.tsx` — dashboard route (from task_08).
- `web/src/features/start-run/StartRunForm.tsx` — start route (from task_09).
- `web/src/features/run-view/RunView.tsx` — run route (from task_10).

### Dependent Files
- `web/src/main.tsx` — renders the router/shell (from task_04).

### Related ADRs
- [ADR-001: Web UI product shape — Operator Console](../adrs/adr-001.md) — Dashboard + one focused run; navigating away ends the stream.

## Deliverables
- Finalized route tree (`/`, `/start`, `/runs/$runId`) + not-found.
- Persistent app shell with cwd switcher and navigation.
- Socket teardown on leaving the run route.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the end-to-end navigation loop **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Navigating to `/runs/abc` renders the run view with `runId="abc"`.
  - [x] Navigating away from `/runs/$runId` calls the attach client's `close()` (spy assertion).
  - [x] An unknown path renders the not-found state.
- Integration tests:
  - [x] Full loop (RTL + router + MSW): with a cwd set, the dashboard lists runs, "Start" opens `/start`, submitting navigates to `/runs/<id>`, and the run view mounts.
  - [x] The cwd switcher is visible and functional on every route (shell persistence).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A user can complete the operate loop entirely in the browser via the routed UI.
- Leaving a run route cleanly closes its live socket.
