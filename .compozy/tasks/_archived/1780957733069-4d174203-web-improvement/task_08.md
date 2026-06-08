---
status: completed
title: Run view migration to shadcn
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 8: Run view migration to shadcn

## Overview
Re-skin the run detail view and its sub-components — banners, transcript, run controls, input box, and step progress — with shadcn primitives (`Alert`, `Card`, `Button`), rendering run status via the shared `StatusBadge`. The live attach WebSocket wiring and all control behavior are preserved; only presentation changes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST re-skin `RunView.tsx`, `RunControls.tsx`, `Transcript.tsx`, `InputBox.tsx`, and `StepProgress.tsx` with shadcn primitives.
- MUST migrate the socket error/closed banners to shadcn `Alert` while preserving their `role` (`alert`/`status`) and `socket-error-notice`/`socket-closed-notice` identifiers.
- MUST migrate the run summary panel to a shadcn `Card` while preserving the `summary-panel` identifier.
- MUST preserve `run-view`, `stop-button`, `retry-button`, `stop-error`, `retry-error` identifiers and the stop/retry enable/disable logic (per status and `closed`).
- MUST preserve the input box enable rule (interactive + not closed + running) and the `sendInput` behavior.
- MUST NOT change the `useAttach` WebSocket reducer/hook or the daemon attach protocol.
- SHOULD render run status using `StatusBadge` where status is displayed.
</requirements>

## Subtasks
- [x] 8.1 Re-skin `RunView` container and migrate the error/closed banners to shadcn `Alert` (roles preserved).
- [x] 8.2 Re-skin `RunControls` buttons and migrate the summary panel to shadcn `Card`.
- [x] 8.3 Re-skin `Transcript` and `StepProgress` presentation.
- [x] 8.4 Re-skin `InputBox`, preserving the enable rule and send behavior.
- [x] 8.5 Render run status via `StatusBadge` where shown.
- [x] 8.6 Update run-view tests while keeping existing selectors/roles valid.

## Implementation Details
Modify the five files under `web/src/features/run-view/`. Do not touch `web/src/lib/ws/*` (attach client, reducer, `use-attach`). See TechSpec "Impact Analysis" (`run-view/*`) and "System Architecture" (Forms & run view).

### Relevant Files
- `web/src/features/run-view/RunView.tsx` — container + socket banners (`role="alert"`/`status`).
- `web/src/features/run-view/RunControls.tsx` — stop/retry buttons + summary panel + error messages.
- `web/src/features/run-view/Transcript.tsx` — event transcript rendering.
- `web/src/features/run-view/InputBox.tsx` — interactive input with enable rule.
- `web/src/features/run-view/StepProgress.tsx` — step progress display.
- `web/src/components/status-badge.tsx` — status presentation (from Task 1).

### Dependent Files
- `web/src/features/run-view/RunView.test.tsx` — assertions on `run-view`, socket notices, controls; preserved.
- `web/src/lib/ws/use-attach.ts` — consumed unchanged; provides `vm`/`sendInput`.

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — Run view migrated as its own bounded PR; banners→`Alert`, summary→`Card`, controls→`Button`.

## Deliverables
- Run view and sub-components re-skinned to shadcn with preserved behavior and selectors.
- Any consumed shadcn primitives present under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the run view under representative attach states **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Socket error renders an `Alert` with `role="alert"` and `socket-error-notice`; socket closed renders `role="status"` and `socket-closed-notice`.
  - [x] Stop button is enabled only when status is `running` and not closed; disabled otherwise.
  - [x] Retry button is enabled only for `failed`/`crashed`/`aborted` and not closed.
  - [x] The summary `Card` (`summary-panel`) renders only for terminal status with a non-null summary.
  - [x] Input box is enabled only when interactive, not closed, and status is `running`.
- Integration tests:
  - [x] With a mocked attach view-model, the run view renders transcript + controls + input; clicking stop/retry triggers the corresponding mutation and surfaces errors on failure.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The run view is fully shadcn with unchanged attach behavior and control logic.
- Every prior run-view test selector and role still resolves.
