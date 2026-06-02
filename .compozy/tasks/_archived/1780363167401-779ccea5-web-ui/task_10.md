---
status: completed
title: "Web: Live run view (WS hook + transcript + controls + summary)"
type: frontend
complexity: high
dependencies:
  - task_06
---

# Task 10: Web: Live run view (WS hook + transcript + controls + summary)

## Overview
Build the focused run view — the heart of the product. It attaches to a run over WebSocket via the task_06 client, renders the live transcript (chat), a step-progress indicator, an interactive input box, inline stop/retry controls, and a final summary panel. This view delivers the full live operate experience for a single run.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The view MUST attach to `/runs/:id/attach` via the task_06 hook and render the reduced `RunViewModel` transcript live, newest activity visible.
- An input box MUST be enabled only when `interactiveEnabled` is true and MUST send `input` frames via the client; it MUST be disabled otherwise.
- A step-progress indicator MUST show entered steps (from `steps`) with the current one active.
- Inline Stop and Retry-step controls MUST call the respective mutations; their availability MUST reflect the current run status (retry only for crashed/failed/aborted; stop only while running).
- A final summary panel MUST appear prominently when the run finishes (status terminal and/or `summary` present).
- Socket close/error MUST be surfaced as a notice without crashing the view; no auto-reconnect (MVP).

## Subtasks
- [x] 10.1 Wire the task_06 attach hook to the run id and expose the view model to the components.
- [x] 10.2 Render the transcript with stream/log/status/banner styling and auto-scroll to latest.
- [x] 10.3 Build the step-progress indicator from `steps`.
- [x] 10.4 Build the interactive input box gated on `interactiveEnabled`, sending input frames.
- [x] 10.5 Add inline stop/retry mutations with status-aware enablement and the final summary panel.
- [x] 10.6 Surface socket close/error notices.

## Implementation Details
Implement `web/src/features/run-view/` per TechSpec "Core Interfaces" (`RunViewModel`) and "Component Overview", and ADR-001/ADR-005. Consume the attach hook + reducer from task_06 and the stop/retry client functions from task_05 (transitively available). Stop/retry are TanStack Query mutations that invalidate the run/runs queries. The route (`/runs/$runId`) is mounted in task_11; this task delivers the run-view component given a `runId` prop.

### Relevant Files
- `web/src/features/run-view/RunView.tsx` — container wiring the hook + subcomponents (new).
- `web/src/features/run-view/Transcript.tsx` — transcript rendering (new).
- `web/src/features/run-view/StepProgress.tsx` — step indicator (new).
- `web/src/features/run-view/InputBox.tsx` — interactive input (new).
- `web/src/features/run-view/RunControls.tsx` — stop/retry + summary panel (new).
- `web/src/lib/ws/use-attach.ts` — attach hook (from task_06).
- `web/src/lib/api/client.ts` — `stopRun`, `retryStep` (from task_05).

### Dependent Files
- `web/src/router.tsx` (task_11) — mounts `/runs/$runId` rendering this view.

### Related ADRs
- [ADR-001: Web UI product shape — Operator Console](../adrs/adr-001.md) — Defines the focused run view's required elements.
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — WS stream feeds the view; mutations via Query.

## Deliverables
- Run-view container + transcript, step-progress, input box, controls, and summary panel.
- Status-aware stop/retry mutations and socket close/error handling.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests driving the view via a fake socket **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The input box is disabled when `interactiveEnabled` is false and enabled when true; sending text calls the client's `sendInput`.
  - [x] The Retry control is enabled only for `failed`/`crashed`/`aborted` status; Stop only for `running`.
  - [x] The step-progress indicator marks the latest `banner` step active and earlier steps inactive.
  - [x] The summary panel renders when the run reaches a terminal status with a `summary`.
- Integration tests:
  - [x] Feeding `snapshot → event(stream) → interactive(true) → status(completed)` through a fake socket renders the streamed text, then enables input, then shows the summary panel (RTL).
  - [x] Clicking Stop invokes `POST /runs/:id/stop` (MSW) and reflects the new status.
  - [x] A socket `error` frame / close renders a notice without unmounting the transcript.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The view streams live activity, supports interactive chat, shows step progress, allows inline stop/retry, and surfaces the final summary.
- Disconnects are handled gracefully without a crash.
