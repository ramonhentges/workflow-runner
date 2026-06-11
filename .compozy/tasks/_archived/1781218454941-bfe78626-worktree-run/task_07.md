---
status: completed
title: Web start-form branch input and run-detail display
type: frontend
complexity: medium
dependencies:
  - task_05
---

# Task 7: Web start-form branch input and run-detail display

## Overview
Let users start an isolated run from the web UI by adding an optional branch input to the start form, and show the worktree path and branch on the run detail view so they can locate the work. This is the browser-facing half of the feature, mirroring the CLI flag.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The start form MUST offer an optional branch input; submitting a non-empty value MUST send `branch` in the start-run request, and leaving it empty MUST start a non-isolated run as today.
- The run detail view MUST display the worktree path and branch when the run is isolated, and show nothing extra otherwise.
- The web API client types MUST include the optional `branch` (request) and `worktreePath`/`branch` (responses) added in task_05.
- A `NOT_A_GIT_REPO` / `WORKTREE_CONFLICT` error from start MUST be surfaced inline in the form.
- New UI primitives, if any, MUST be installed via the shadcn CLI per project conventions (see CLAUDE.md "Web UI components").
</requirements>

## Subtasks
- [x] 7.1 Add an optional branch input to the start form and include `branch` in the submitted request.
- [x] 7.2 Extend the web API client/types for `branch` in and `worktreePath`/`branch` out.
- [x] 7.3 Display worktree path and branch on the run detail view for isolated runs.
- [x] 7.4 Surface isolation start errors inline in the form.

## Implementation Details
Modify `web/src/features/start-run/StartRunForm.tsx` (add the input; pass `branch` into the `startRun` mutation, which currently sends `{ workflowPath, cwd }`), the web API client/types under `web/src/lib/api/`, and the run detail view in `web/src/features/run-view/RunView.tsx`. Run `bun run test` and `bun run typecheck` from `web/` after. See TechSpec "Impact Analysis" and the PRD "User Experience" section.

### Relevant Files
- `web/src/features/start-run/StartRunForm.tsx` — start form; `useMutation` calling `startRun`.
- `web/src/lib/api/client` / `web/src/lib/api/types` — request/response typing.
- `web/src/features/run-view/RunView.tsx` — run detail rendering.
- `web/components.json` / `web/src/components/ui/` — shadcn primitives (Input/Label already present).

### Dependent Files
- None downstream; this is a leaf UI surface.

### Related ADRs
- [ADR-001: Opt-in per-run git worktree isolation with a user-provided branch](adrs/adr-001.md) — Opt-in branch entry at start.
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Fields displayed on run detail.

## Deliverables
- Optional branch input in the start form that drives an isolated run.
- Worktree path and branch shown on the run detail view for isolated runs.
- Updated web API client/types.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration/component tests for the start form and run-detail rendering **(REQUIRED)**

## Tests
- Unit/component tests:
  - [x] Submitting the start form with a branch value sends `branch` in the request payload.
  - [x] Submitting with an empty branch sends no `branch` (non-isolated start).
  - [x] The run detail view renders the worktree path and branch for an isolated run.
  - [x] The run detail view renders no worktree/branch section for a non-isolated run.
  - [x] A `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` start error is shown inline in the form.
- Integration tests:
  - [x] Start form → mocked start-run endpoint with a branch navigates to the run view and the worktree/branch appear.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `bun run typecheck` (from `web/`) passes
- Users can start isolated runs from the browser and see the worktree path/branch
