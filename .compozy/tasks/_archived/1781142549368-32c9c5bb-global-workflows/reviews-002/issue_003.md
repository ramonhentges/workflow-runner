---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T00:52:21Z
status: resolved
file: web/src/router.tsx
line: 89
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Duplicate silently opens a blank editor when the source fetch fails

## Review Comment

`NewWorkflowPage` (`router.tsx:89-106`) handles the duplicate flow (`from` +
`scope` seed the new workflow from an existing one). It renders a loading state
while the source fetch is in flight, but it has **no error branch**: when
`useWorkflow(from, scope)` fails (transient network error, or the source was
deleted/renamed between list render and the click), `sourceDoc` is `undefined`,
`isLoading` becomes false, and:

```ts
const initialValues = from && sourceDoc ? workflowDocToFormData(sourceDoc, '') : undefined
return <WorkflowEditor mode="create" initialValues={initialValues} />
```

So the editor opens as a **blank** create form with no indication that the
copy failed — silently discarding the user's intent to duplicate. Contrast
`EditWorkflowPage` (`router.tsx:122-128`), which surfaces a `workflow-not-found`
state on `isError || !workflowDoc`.

This is the residual UX gap behind round-1 issue 001 (which fixed the *scope*
threading so the correct document is fetched); the error-handling hole remains.

Suggested fix: when `from` is set, treat a fetch error like the edit page does —
surface a "Couldn't load the workflow to duplicate" message (with a link back to
`/workflows`) instead of rendering a blank editor, so a failed copy is visible
rather than silent.

## Triage

- Decision: `VALID`
- Root cause: `NewWorkflowPage` (`router.tsx:89-106`) destructures only
  `{ data: sourceDoc, isLoading }` from `useWorkflow(from, scope)`. When the
  duplicate source fetch fails, `isLoading` settles to `false` and `sourceDoc`
  stays `undefined`, so `initialValues` falls back to `undefined` and a blank
  create form renders — silently discarding the user's intent to duplicate.
  `EditWorkflowPage` already guards `isError || !workflowDoc`; the duplicate
  path has no equivalent error branch.
- Fix approach: mirror the edit page. Destructure `isError` and, when `from`
  is set with an active cwd, render a dedicated error state ("Couldn't load the
  workflow to duplicate") that links back to `/workflows`, instead of opening a
  blank editor. Cover the new branch with a routing test that returns a 500 for
  the source read and asserts the error state plus the back link.
- Notes: change constrained to `web/src/router.tsx` plus its
  `__tests__/routing.test.tsx` companion.
