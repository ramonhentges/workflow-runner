# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Combined project+global workflow list with a per-row scope badge; rows keyed by
`scope+name`; edit/delete row actions carry the row's `scope`. DONE + verified
(uncommitted).

## Important Decisions

- Delete now goes through `useDeleteWorkflow()` (task_05 hook) with
  `{ scope: workflow.scope, name: bareName }`; confirm-reset + error-banner moved
  to per-call `mutate(vars, { onSuccess, onError })` callbacks. Dropped the inline
  `useMutation`/`deleteWorkflow` import and the now-unused `workflowListQueryKey`
  import (the hook owns list invalidation).
- Edit action carries scope as a **search param**: edit `<Link>` gets
  `search={{ scope: workflow.scope }}`, and `editWorkflowRoute` in `router.tsx`
  got a `validateSearch` parsing `scope` (unknown/absent → `project`). This is the
  minimal router touch needed for task_06's "carry scope into row actions"; task_07
  still owns consuming that scope in `EditWorkflowPage` (`useWorkflow(name, scope)`)
  and the editor toggle/read-only badge.
- Row `data-testid` kept as `workflow-row-${bareName}` (NOT scope-qualified) to
  avoid churning the ~15 existing tests; same-name cross-scope rows therefore share
  a testid — new tests use `getAllByTestId`. React `key` is the scope-qualified
  `${scope}-${bareName}` (that's what prevents the duplicate-key warning).
- Badge variants: global → `secondary`, project → `outline`; text via
  `scopeLabel()`. Badge carries `data-testid="workflow-scope-badge"` and
  `data-scope`.

## Learnings

- Existing WorkflowList tests pass scope-less fixtures; `workflow.scope` is then
  `undefined`, so the badge renders "Project" (else branch) and delete sends no
  `scope` param (apiFetch skips undefined params) — old tests stay green untouched.
- TanStack Router drops search params a route doesn't `validateSearch`; the test
  helper's `editWorkflowRoute` needed the same `validateSearch` for the
  edit-scope navigation assertion to see `{ scope: 'global' }`.

## Files / Surfaces

- `web/src/features/workflows/WorkflowList.tsx` — badge column, scope key, scoped
  edit Link + delete via hook.
- `web/src/router.tsx` — `editWorkflowRoute.validateSearch` adds optional `scope`.
- `web/src/features/workflows/WorkflowList.test.tsx` — +5 tests (badges, same-name
  coexistence, edit-scope nav, delete-scope param, integration mixed-scope) and
  `validateSearch` on the helper edit route.

## Errors / Corrections

- None.

## Ready for Next Run

- task_07 can read `editWorkflowRoute.useSearch().scope` (now validated) to thread
  scope into `useWorkflow(name, scope)` and the editor's read-only scope badge.
