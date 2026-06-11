---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T00:52:21Z
status: resolved
file: web/src/features/workflows/useWorkflow.ts
line: 66
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Editing a workflow can re-open the editor with pre-edit content

## Review Comment

Editing a global (or project) workflow is a core PRD deliverable ("edit a global
workflow once... takes effect on the next run"). After a successful edit the user
is navigated back to `/workflows`; re-opening the same workflow in the editor can
show the **pre-edit** content, so the edit appears to have been lost.

Cause — the per-workflow cache is never refreshed on update:

- `useUpdateWorkflow.onSuccess` (`useWorkflow.ts:66-69`) invalidates only the
  combined list (`workflowListQueryKey`), not the per-workflow query
  `workflowQueryKey(cwd, scope, name)` (`:20-26`).
- On re-open, `EditWorkflowPage` (`router.tsx:108-138`) reads that cache via
  `useWorkflow(name, scope)`. With a cached (stale, pre-edit) doc present,
  `isLoading` is false, so the loading guard is skipped and the editor renders
  immediately seeded from the stale doc.
- `WorkflowEditor` seeds react-hook-form via `useForm({ defaultValues: ... })`
  (`WorkflowEditor.tsx:58-61`). RHF applies `defaultValues` once at init and does
  **not** re-seed when the background refetch later lands fresh data, so the form
  keeps the stale values for the cache's lifetime (default gcTime ~5 min).

Note a naive "just invalidate the per-workflow key" fix is insufficient:
invalidation still returns the stale cached doc immediately on the next mount,
and RHF still won't re-seed. Fix by making the cache hold fresh data before the
next mount — in `useUpdateWorkflow.onSuccess`, write the mutation's returned
`WorkflowDoc` into the per-workflow cache (or remove it), e.g.
`queryClient.setQueryData(workflowQueryKey(cwd, scope, newName), doc)` and
`removeQueries` for the old name on rename. (Alternatively, drive the editor form
from RHF `values`/`reset` instead of `defaultValues`.)

## Triage

- Decision: `VALID`
- Root cause: `useUpdateWorkflow.onSuccess` (`useWorkflow.ts:66-69`) invalidates only
  the combined list query (`workflowListQueryKey`). The per-workflow detail query
  `workflowQueryKey(cwd, scope, name)` — the cache `EditWorkflowPage`/`useWorkflow`
  reads on re-open — is left holding the stale pre-edit `WorkflowDoc`. Because that
  cache entry stays `fresh`/present, `isLoading` is false on the next mount, the
  loading guard is skipped, and `WorkflowEditor` seeds RHF from the stale doc via
  `useForm({ defaultValues })`, which RHF only applies once at init. A bare
  `invalidateQueries` of the per-workflow key is insufficient: the stale cached doc
  is still returned synchronously on the next mount before the background refetch
  lands, and RHF still won't re-seed.
- Fix approach: in `onSuccess`, receive the mutation's returned `WorkflowDoc` and the
  mutation vars, then write the fresh doc into the per-workflow cache under the
  (possibly renamed) result name via `queryClient.setQueryData(...)`, so the next
  mount reads fresh data immediately. On rename, also `removeQueries` for the old
  name's per-workflow key so the obsolete entry cannot be re-read. The combined-list
  invalidation is retained.
- Notes: Scope is fixed for a PUT (passed as a query param, not mutated), so the
  same `vars.scope` is used for both the new and old per-workflow keys.
