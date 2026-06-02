---
status: completed
title: "Web: Start-run flow (workflow picker + manual path)"
type: frontend
complexity: medium
dependencies:
  - task_03
  - task_05
  - task_07
---

# Task 09: Web: Start-run flow (workflow picker + manual path)

## Overview
Let the user start a run from the active cwd: pick a workflow from that directory's `./workflows` folder (via `GET /workflows`) or enter a path manually, then submit to `POST /runs` and navigate into the new run's live view. This is the entry point of the operate loop.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- A `useWorkflows` query hook MUST fetch `GET /workflows?cwd=<active>` for the picker; the list MUST refresh when the active cwd changes.
- The form MUST allow either selecting a listed workflow or entering a manual `workflowPath`, and MUST submit `{ workflowPath, cwd }` (cwd = active cwd) via a `POST /runs` mutation.
- On success the flow MUST navigate to the new run's focused route using the returned `runId`.
- The flow MUST require an active cwd; with none set it MUST prompt the user to select/add one (no start without a cwd).
- Submission errors MUST surface inline without losing entered input.

## Subtasks
- [x] 09.1 Implement the `useWorkflows` query hook keyed by the active cwd.
- [x] 09.2 Implement the `startRun` mutation invalidating the runs query on success.
- [x] 09.3 Build the start-run form (picker + manual-path field, validation).
- [x] 09.4 Navigate to the focused run route on success; surface errors inline.
- [x] 09.5 Handle the no-active-cwd case and cover the flow with tests.

## Implementation Details
Implement `web/src/features/start-run/` per TechSpec "API Endpoints" (`GET /workflows`, `POST /runs`) and ADR-006. Use the HTTP client/types from task_05, the active cwd from task_07, and the daemon endpoint from task_03. The route (`/start`) is mounted in task_11; the form and hooks are self-contained and testable here. Manual-path entry is the fallback when the picker is empty.

### Relevant Files
- `web/src/features/start-run/useWorkflows.ts` — workflow listing query (new).
- `web/src/features/start-run/StartRunForm.tsx` — form + submit (new).
- `web/src/lib/api/client.ts` — `listWorkflows`, `startRun` (from task_05).
- `web/src/stores/cwd-store.ts` — active cwd (from task_07).

### Dependent Files
- `web/src/router.tsx` (task_11) — mounts `/start` and the post-start navigation target.
- `web/src/features/dashboard/useRuns.ts` (task_08) — invalidated on successful start.

### Related ADRs
- [ADR-006: GET /workflows?cwd= listing endpoint](../adrs/adr-006.md) — Powers the picker.
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — Query/mutation usage.

## Deliverables
- `useWorkflows` query + `startRun` mutation.
- Start-run form supporting picker and manual path, with active-cwd gating.
- Post-start navigation into the run view.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the start flow with MSW **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `useWorkflows` issues `GET /workflows?cwd=<active>` and re-fetches when the active cwd changes.
  - [x] Submitting with a selected workflow POSTs `{ workflowPath: <selected>, cwd: <active> }`.
  - [x] Submitting with a manual path POSTs that path; empty path + no selection blocks submit with a validation message.
  - [x] With no active cwd, the form shows the select/add-cwd prompt and does not submit.
- Integration tests:
  - [x] With MSW returning two workflows and a `POST /runs` → `{ runId }`, choosing one and submitting navigates to `/runs/<runId>` (router + RTL).
  - [x] A `POST /runs` 400 error renders inline while preserving the entered path.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The user can start a run from a listed workflow or a manual path scoped to the active cwd.
- Successful starts land on the focused run view; errors are shown without data loss.
