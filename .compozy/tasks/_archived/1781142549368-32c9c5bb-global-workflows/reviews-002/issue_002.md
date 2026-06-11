---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T00:52:21Z
status: resolved
file: web/src/features/start-run/useWorkflows.ts
line: 9
severity: low
author: claude-code
provider_ref:
---

# Issue 002: Start-run picker hand-rolls the list query key, risking invalidation drift

## Review Comment

The start-run picker's `useWorkflows` hook (`start-run/useWorkflows.ts`) is a
byte-for-byte duplicate of `workflows/useWorkflowList.ts`, and it inlines the
query key as `['workflows', activeCwd?.path ?? null]` instead of importing the
shared `workflowListQueryKey` helper (`useWorkflowList.ts:5-7`).

The create/edit/delete mutation hooks invalidate `workflowListQueryKey(cwd)`
(`useWorkflow.ts:51-53,67-69,82-85`). Today the inlined key is string-identical,
so the picker does get refreshed after a global/project create or delete. But the
two key definitions are now a latent coupling: any future change to
`workflowListQueryKey` (adding a segment, a prefix, etc.) silently stops
invalidating the start-run picker, leaving it showing a stale combined workflow
list after the user creates or deletes a workflow — exactly the kind of
scope-aware list the PRD relies on for "Run a global workflow."

Suggested fix: delete `start-run/useWorkflows.ts` and have `StartRunForm` consume
`useWorkflowList`/`workflowListQueryKey` from `features/workflows`, so there is a
single source of truth for the combined-list query key and cache entry.

## Triage

- Decision: `VALID`
- Notes:
  - Confirmed: `start-run/useWorkflows.ts` duplicated the hook body of
    `workflows/useWorkflowList.ts` and inlined the list query key as
    `['workflows', activeCwd?.path ?? null]` instead of using the shared
    `workflowListQueryKey` helper (`useWorkflowList.ts:5-7`).
  - Root cause: two independent definitions of the same query key. The
    create/edit/delete mutations invalidate `workflowListQueryKey(cwd)`
    (`useWorkflow.ts:52,77,93`). The keys are string-identical today, so
    invalidation reaches the picker, but any future change to
    `workflowListQueryKey` would silently stop refreshing the start-run picker —
    a latent invalidation-drift bug for the scope-aware combined list the PRD
    relies on.
  - Fix approach: establish a single source of truth by collapsing
    `start-run/useWorkflows.ts` into a re-export of the shared
    `useWorkflowList` hook (aliased as `useWorkflows`). This removes the
    duplicated hook body and the inlined query key entirely while keeping the
    start-run feature's public `useWorkflows` API and its callers
    (`StartRunForm.tsx`, `StartRunForm.test.tsx`) unchanged — no out-of-scope
    edits required. The reviewer's literal suggestion (delete the file and
    repoint `StartRunForm`) would force churn in two out-of-scope files and
    duplicate the existing `useWorkflowList` test coverage; the re-export
    achieves the same single-source-of-truth goal with strictly less blast
    radius.
