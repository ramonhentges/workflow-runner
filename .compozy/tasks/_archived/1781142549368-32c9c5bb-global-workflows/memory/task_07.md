# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Editor scope: create-form Global/Project toggle (default Project) wired to create mutation; read-only scope badge in edit mode; edits preserve scope. DONE + verified (uncommitted).

## Important Decisions

- Scope is NOT part of `WorkflowDraftSchema`/`toWorkflowPayload` — it is a "where to save" decision derived from file location (ADR-003), so it stays as local `useState` in the editor, not in the form model. Schema untouched.
- Reused existing primitives: `Button` group for the create toggle, `Badge` for the read-only edit display. No new shadcn dependency installed.
- Switched the editor off its inline `useMutation` to the task_05 hooks `useCreateWorkflow`/`useUpdateWorkflow`; navigation + server-error handling moved to per-call `mutate(vars, { onSuccess, onError })` callbacks (mirrors WorkflowList's delete pattern). The hooks own list invalidation.
- `effectiveScope = mode==='edit' ? (existingScope ?? 'project') : createScope`. Edit always sends the unchanged scope to `updateWorkflow` (an in-place PUT, no scope change).

## Learnings

- `editWorkflowRoute` already had `validateSearch` parsing `scope` (task_06). task_07 just consumed `editWorkflowRoute.useSearch().scope` into `useWorkflow(name, scope)` and `<WorkflowEditor scope={scope}>`.

## Files / Surfaces

- `web/src/features/workflows/WorkflowEditor.tsx` — added `scope` prop, `createScope` state, toggle (`scope-toggle`/`scope-toggle-project`/`scope-toggle-global`) + read-only `scope-badge`; switched to task_05 hooks.
- `web/src/router.tsx` — `EditWorkflowPage` threads `useSearch().scope` into `useWorkflow` + editor.
- `web/src/features/workflows/WorkflowEditor.test.tsx` — +6 tests (toggle default, create-global, create-default-project, read-only edit badge, edit preserves scope, integration create-as-global→list Global badge).

## Errors / Corrections

## Ready for Next Run

- Verified: `bun run typecheck` clean; `bun run test` 28 files / 433 pass; coverage 94% stmt (gate 80%). Uncommitted (`--auto-commit=false`).
- Only task_08 (start-run picker surfaces scope) remains in this PRD.
