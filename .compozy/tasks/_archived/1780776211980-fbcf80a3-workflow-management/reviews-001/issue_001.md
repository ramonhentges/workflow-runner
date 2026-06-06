---
provider: manual
pr:
round: 1
round_created_at: 2026-06-05T13:25:26Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 64
severity: high
author: claude-code
provider_ref:
---

# Issue 001: "Duplicate existing workflow" has no UI entry point

## Review Comment

Creating a workflow by duplicating an existing one is a PRD must-have, not a
nice-to-have: it is Core Feature #2 ("Create workflow — Two ways to start:
Blank / Duplicate existing"), two user stories ("I want to create a new
workflow by duplicating an existing one…"), and an explicit MVP success
criterion ("Create (blank + duplicate)…"). The TechSpec route is `/workflows/new`
with an optional `?from=<name>` search param.

All the plumbing for duplicate exists and is even tested:
- `router.tsx` `NewWorkflowPage` reads `from`, loads the source via `useWorkflow(from)`,
  and prefills with `workflowDocToFormData(sourceDoc, '')` (blank file name).
- `WorkflowEditor` supports prefilled `initialValues`.
- Tests cover duplicate prefill mode (`WorkflowEditor.test.tsx:249`, `:823`).

But the only navigation into that route is the "New workflow" link in
`WorkflowList.tsx:64`, which hard-codes `search={{ from: undefined }}`. Each
workflow row (`WorkflowList.tsx:124`) exposes only **Edit** and **Delete** —
there is no "Duplicate" action that links to
`/workflows/new` with `search={{ from: bareName }}`. As shipped, a user cannot
reach the duplicate flow from the UI at all, so a must-have user story is
undeliverable through the product even though the code path works.

Suggested fix: add a "Duplicate" action per row in `WorkflowList` (alongside
Edit/Delete) that navigates to `/workflows/new` with `search={{ from: bareName }}`,
and add a test asserting the link target. The backend/editor need no changes.

## Triage

- Decision: `VALID`
- Root cause: The `/workflows/new` route (`router.tsx:46-53`) fully supports the
  duplicate flow via the optional `from` search param — `NewWorkflowPage`
  (`router.tsx:72-89`) loads the source workflow with `useWorkflow(from)` and
  prefills the editor with `workflowDocToFormData(sourceDoc, '')`. The editor
  and backend need no changes. However, `WorkflowList.tsx` exposes no navigation
  into that flow with a populated `from`: the header "New workflow" link
  hard-codes `search={{ from: undefined }}` (`WorkflowList.tsx:64`) and each row
  (`WorkflowList.tsx:124`) offers only Edit and Delete. The duplicate user story
  (PRD Core Feature #2 / MVP "Create (blank + duplicate)") is therefore
  unreachable through the UI despite the code path existing and being tested.
- Fix approach: Add a per-row "Duplicate" action (a `Link`) alongside Edit/Delete
  that navigates to `/workflows/new` with `search={{ from: bareName }}`, using the
  same `actionLinkClass` styling and a lucide `Copy` icon for visual consistency.
  Add a navigation test asserting the link target carries `from: <bareName>`.
- Resolution: Added a per-row "Duplicate" `Link` to `/workflows/new` with
  `search={{ from: bareName }}` in `WorkflowList.tsx` (between Edit and Delete),
  styled with `actionLinkClass` and a lucide `Copy` icon. Added test
  "duplicate action navigates to the new workflow route with the source name"
  in `WorkflowList.test.tsx` asserting `pathname === '/workflows/new'` and
  `search === { from: 'alpha' }`. Verified: `tsc --noEmit` clean,
  `vitest run` 290/290 passed (20 files), `vite build` succeeded.
