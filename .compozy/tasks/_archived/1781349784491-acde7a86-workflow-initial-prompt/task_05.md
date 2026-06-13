---
status: completed
title: Web — optional prompt field on both start forms
type: frontend
complexity: medium
dependencies:
  - task_03
---

# Task 5: Web — optional prompt field on both start forms

## Overview
Add an optional multi-line "initial prompt" field to both web run-start surfaces —
the dedicated Start Run form and the workflow-list run dialog — so a user can direct
a run from the web. The field mirrors the existing branch field: clearly labeled,
blank by default, and omitted from the request when empty.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `initialPrompt?: string` to the web `StartRunRequest` type.
- MUST add an optional multi-line prompt input to `StartRunForm`, shaped into the
  request only when non-empty (mirroring the existing branch handling).
- MUST add the same optional prompt input to the `WorkflowList` run dialog, included
  in its start mutation only when non-empty.
- MUST use the shadcn `textarea` primitive; install it via the project CLI if it is
  not already present in `web/src/components/ui/`.
- MUST keep the no-prompt submission byte-for-byte equivalent to today (field
  omitted, not sent as empty string).
</requirements>

## Subtasks
- [x] 5.1 Add `initialPrompt?` to the web `StartRunRequest` type.
- [x] 5.2 Ensure the shadcn `textarea` primitive exists (install via CLI if missing).
- [x] 5.3 Add an optional prompt textarea to `StartRunForm` and shape it into the request when non-empty.
- [x] 5.4 Add an optional prompt textarea to the `WorkflowList` run dialog and include it in the start mutation when non-empty.
- [x] 5.5 Add component tests covering submit-with-prompt and submit-without-prompt for both surfaces.

## Implementation Details
See TechSpec "Impact Analysis" (web rows) and "Data Models". Follow the existing
branch-field pattern in both components — including the `...(value ? { field } : {})`
request shaping — and the CLAUDE.md guidance for adding a shadcn primitive
(`cd web && bunx --bun shadcn@latest add textarea`). Do not duplicate component code
from the TechSpec.

### Relevant Files
- `web/src/lib/api/types.ts` — `StartRunRequest`; add optional `initialPrompt`.
- `web/src/features/start-run/StartRunForm.tsx` — add the prompt field and request shaping.
- `web/src/features/workflows/WorkflowList.tsx` — add the prompt field to the run dialog and mutation.
- `web/src/components/ui/textarea.tsx` — shadcn primitive (create via CLI if absent).
- `web/src/lib/api/client.ts` — `startRun` request passthrough (verify it forwards the new field).

### Dependent Files
- `src/app/api/routes/start-run.ts` — server route that receives the field (task 03).

### Related ADRs
- [ADR-001: Unified optional initial prompt across all run-start surfaces](../adrs/adr-001.md) — both web surfaces get the field in one release.

## Deliverables
- `StartRunRequest.initialPrompt?` web type.
- Optional prompt textarea on both `StartRunForm` and the `WorkflowList` run dialog, shaped into the request only when non-empty.
- shadcn `textarea` primitive present in the project.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for both start surfaces submitting the prompt **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `StartRunForm` submits `initialPrompt` in the request when the textarea is filled.
  - [x] `StartRunForm` omits `initialPrompt` from the request when the textarea is blank.
  - [x] `WorkflowList` run dialog submits `initialPrompt` when filled and omits it when blank.
- Integration tests:
  - [x] Filling the prompt and starting a run from `StartRunForm` calls the `startRun` client with the prompt and navigates to the run view (mocked client).
  - [x] Starting from the `WorkflowList` dialog with a prompt passes it through the start mutation (mocked client).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A user can start a run with a prompt from either web surface.
- Starting without a prompt produces the same request as today.
