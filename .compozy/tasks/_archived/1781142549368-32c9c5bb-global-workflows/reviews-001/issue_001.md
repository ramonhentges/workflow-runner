---
provider: manual
pr:
round: 1
round_created_at: 2026-06-10T20:35:32Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 220
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Duplicating a global workflow loses scope and copies wrong/blank source

## Review Comment

The "Duplicate" action does not carry the row's `scope` into the create flow, so
duplicating a **global** workflow silently fails to copy its content.

Trace:

- `WorkflowList.tsx:220` — `<Link to="/workflows/new" search={{ from: bareName }}>`
  passes only the bare name, not `scope`.
- `router.tsx:54-56` — the `/workflows/new` route's `validateSearch` parses only
  `from`; there is no `scope` search param.
- `router.tsx:86` — `NewWorkflowPage` calls `useWorkflow(from)`, which defaults
  to `scope = 'project'` (`useWorkflow.ts:28`).

Result: when the user duplicates a global workflow, `getWorkflow` is issued with
`scope=project`. If no same-named project workflow exists, the request 404s,
`sourceDoc` is `undefined`, and the editor opens **blank** instead of a copy. If
a same-named *project* workflow does exist (the collision case the PRD calls
out), the duplicate is seeded from the **wrong** (project) document. Either way
the global source is never copied, which breaks the create/edit/duplicate parity
the PRD requires for global workflows.

Suggested fix: thread `scope` through the duplicate path. Add `scope` to the
`/workflows/new` route's `validateSearch` (mirroring the edit route at
`router.tsx:66-68`), pass `search={{ from: bareName, scope: workflow.scope }}`
from the Duplicate link, and call `useWorkflow(from, scope)` in
`NewWorkflowPage`. The "New workflow" links at `WorkflowList.tsx:88` and `:148`
pass `from: undefined` and can default `scope` to `'project'`.

## Triage

- Decision: `VALID`
- Root cause: The Duplicate `<Link>` at `WorkflowList.tsx:220` passes only
  `search={{ from: bareName }}` and never the row's `scope`. The
  `/workflows/new` route (`router.tsx:54-56`) only validates/parses `from`, and
  `NewWorkflowPage` (`router.tsx:86`) calls `useWorkflow(from)` which defaults to
  `scope = 'project'` (`useWorkflow.ts:28`). Confirmed via code reading: for a
  global row this issues `getWorkflow(cwd, 'project', name)`, which either 404s
  (blank editor) or seeds from the wrong project-scoped document on a name
  collision. The Edit and Delete paths already thread scope correctly
  (`router.tsx:66-68`, `WorkflowList.tsx:213,248`), so Duplicate is the lone gap.
- Fix approach (mirrors the existing edit-route scope plumbing):
  1. `router.tsx` — add `scope` to the `/workflows/new` route's `validateSearch`
     (coerced to `'global'` | `'project'`, default `'project'`), and thread it
     into `useWorkflow(from, scope)` in `NewWorkflowPage`.
  2. `WorkflowList.tsx` — Duplicate link passes
     `search={{ from: bareName, scope: workflow.scope }}`; the two "New workflow"
     entry points pass `scope: 'project'` alongside `from: undefined`.
- Out-of-batch file note: the fix necessarily touches `web/src/router.tsx`
  (the route's `validateSearch` and `NewWorkflowPage`) because the search-param
  schema and the seeding query live there, not in `WorkflowList.tsx`. The change
  is scoped to the minimum needed to thread `scope` through the duplicate path.
- Tests: updated the existing duplicate-navigation test and added a global-row
  duplicate test in `WorkflowList.test.tsx`, plus an end-to-end routing test in
  `routing.test.tsx` asserting `getWorkflow` is issued with `scope=global` when a
  global workflow is duplicated.
