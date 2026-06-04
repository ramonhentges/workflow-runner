---
status: completed
title: Docs, example workflow & manual E2E procedure
type: docs
complexity: medium
dependencies:
  - task_02
  - task_03
  - task_04
  - task_05
  - task_06
---

# Task 7: Docs, example workflow & manual E2E procedure

## Overview
Document the multi-IDE capability and prove it end to end. Update the workflow-format
reference and example, then extend the manual E2E procedure to exercise all four agents
in one workflow including a cross-agent handoff and an unavailable-agent failure. This
is the task that validates full parity and the fail-at-the-step behavior in reality.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The workflow JSON format docs (CLAUDE.md and/or README) MUST state that `ide` is required and list the supported values (`opencode`, `claude-code`, `codex`, `gemini`).
- An example MUST demonstrate a multi-agent workflow with at least one cross-agent handoff and MUST load successfully via `Workflow.load`.
- The README manual E2E procedure MUST be extended to: run a workflow whose steps span all four agents including a cross-agent handoff, and verify a step naming an unavailable agent fails at that step (naming step + `ide`) while earlier steps' artifacts persist.
- Docs MUST note that each agent CLI must be installed, authenticated, and ACP-reachable as an operator prerequisite.
- MUST NOT change runtime behavior; this task is documentation, an example workflow, and the E2E procedure only.
</requirements>

## Subtasks
- [x] 7.1 Update the workflow JSON format reference (required `ide` + supported values).
- [x] 7.2 Add/extend an example workflow demonstrating mixed agents and a cross-agent handoff.
- [x] 7.3 Document per-agent operator prerequisites (install/auth/ACP reachability).
- [x] 7.4 Extend the README manual E2E procedure for the four-agent run and the unavailable-agent failure.
- [x] 7.5 Execute the four-agent E2E and record the result.

## Implementation Details
Update `CLAUDE.md` ("Workflow JSON format" and "End-to-end testing" sections) and
`README.md` (E2E procedure). Add a multi-agent example under `workflows/` (e.g. extend
or supplement `workflows/who-is.json`). The example must pass `Workflow.load`/`compozy`
validation. The E2E steps follow the PRD "Phased Rollout — MVP success criteria". See
TechSpec "Testing Approach — Integration Tests" and "Monitoring and Observability"
(active-agent visibility in logs).

### Relevant Files
- `CLAUDE.md` — workflow format + E2E sections to update.
- `README.md` — manual E2E procedure to extend.
- `workflows/who-is.json` — existing example to extend or pair with a multi-agent example.

### Dependent Files
- `src/domain/workflow.ts` — any example workflow must satisfy its validation (required `ide` from task_03).

### Related ADRs
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — four agents, full parity, fail-at-the-step.
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — the supported-id set documented here matches the registry.

## Deliverables
- Updated workflow-format docs and per-agent prerequisites.
- A multi-agent example workflow that loads successfully.
- Extended README manual E2E procedure plus a recorded run result.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for example-workflow loading **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The multi-agent example workflow loads via `Workflow.load` with every step carrying a supported `ide` and at least two distinct `ide` values present.
  - [x] The example's cross-agent handoff edge references an existing step id (edge validation passes).
- Integration tests:
  - [x] Manual E2E: a workflow spanning all four agents runs end to end with at least one cross-agent handoff; result recorded in the README procedure (Test Case 6).
  - [x] Manual E2E: a step naming an unavailable agent fails at that step with a message naming the step and `ide`, while earlier steps' artifacts remain (Test Case 7).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Docs list required `ide` and all four supported values with prerequisites.
- The four-agent E2E (including cross-agent handoff and unavailable-agent failure) is documented and has been run successfully.
