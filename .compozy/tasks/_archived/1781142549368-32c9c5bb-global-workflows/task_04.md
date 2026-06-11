---
status: completed
title: "Web API layer: scope on types & client"
type: frontend
complexity: low
dependencies:
  - task_01
---

# Task 4: Web API layer: scope on types & client

## Overview
Mirror the server scope contract in the web API layer so the rest of the UI can
read and send scope. This adds `scope` to the web `WorkflowItem` type and threads
an explicit `scope` through the five workflow client functions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `scope: "global" | "project"` field to the web `WorkflowItem` type, matching the server contract from task_01.
- MUST thread a `scope` argument through `getWorkflow`, `createWorkflow`, `updateWorkflow`, and `deleteWorkflow` so it is sent as the `scope` query param.
- MUST keep `listWorkflows` returning the combined list as-is (the server merges scopes); only the item type changes.
- SHOULD send `scope` explicitly on every CRUD call rather than relying on the server default, so requests are unambiguous.
- MUST keep the request URL/param construction consistent with the existing `apiFetch` usage.
</requirements>

## Subtasks
- [x] 4.1 Add `scope` to the `WorkflowItem` interface in the web API types.
- [x] 4.2 Thread a `scope` argument into `getWorkflow`/`createWorkflow`/`updateWorkflow`/`deleteWorkflow` and append it as a query param.
- [x] 4.3 Confirm `listWorkflows` consumes the combined scoped list unchanged.
- [x] 4.4 Extend client tests to assert the `scope` param is sent and the scoped item type round-trips.

## Implementation Details
Modify `web/src/lib/api/types.ts` (the `WorkflowItem` interface) and
`web/src/lib/api/client.ts` (the workflow CRUD helpers). The functions currently
take `(cwd, ...)`; add `scope` to the signature and the `params` object passed to
`apiFetch`. See TechSpec "System Architecture" (web layer) and "API Endpoints".

### Relevant Files
- `web/src/lib/api/types.ts` — `WorkflowItem`, `WorkflowDoc`, CRUD body/result types.
- `web/src/lib/api/client.ts` — `listWorkflows`, `getWorkflow`, `createWorkflow`, `updateWorkflow`, `deleteWorkflow`.
- `web/src/lib/api/client.test.ts` — existing client tests to extend.

### Dependent Files
- `web/src/features/workflows/useWorkflowList.ts`, `useWorkflow.ts` — call these helpers (task_05).
- `web/src/features/workflows/WorkflowList.tsx` — consumes the scoped item type (task_06).

### Related ADRs
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — the scope query param the client must send.

## Deliverables
- `scope` on the web `WorkflowItem` type and on all CRUD client signatures.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: covered by the hook/component tasks (task_05–08) that exercise these helpers in context **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `createWorkflow(cwd, "global", body)` issues a request with `scope=global` in the query.
  - [x] `deleteWorkflow(cwd, "project", name)` issues a request with `scope=project`.
  - [x] `getWorkflow` forwards `scope` alongside `cwd`.
  - [x] `listWorkflows` parses a response whose items each carry a `scope` field.
- Integration tests:
  - [x] Deferred to task_05–08 which mount hooks/components against these helpers.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `scope` is part of the web item type and is sent on every CRUD request.
- `listWorkflows` consumes the combined scoped list without other call-site changes.
