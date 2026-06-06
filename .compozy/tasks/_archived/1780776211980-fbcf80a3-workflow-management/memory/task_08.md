# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement workflow editor (create/edit) with react-hook-form + zod. Status: complete.

## Important Decisions

- `WorkflowDraftSchema` uses `superRefine` for cross-field validation (duplicate step ids, edge references). In zod v4, `ctx.path` (reading) is gone but `ctx.addIssue({ path: [...] })` still works for setting per-field error paths.
- `WorkflowEditor` is a "dumb" form component that receives `initialValues` as a prop. The route-level page components (`NewWorkflowPage`, `EditWorkflowPage` in `router.tsx`) handle loading state and data fetching.
- Duplicate mode uses `?from=<name>` search param on `/workflows/new`. `workflowDocToFormData(doc, '')` clears the fileName so user must enter a new name.
- `@hookform/resolvers` v5.4.0 supports both zod v3 and v4 via auto-detection — no special config needed.
- Added `validateSearch` to `newWorkflowRoute` in `router.tsx`; this requires `WorkflowList.tsx` link to pass `search={{ from: undefined }}` instead of bare `to="/workflows/new"` (TanStack Router type requirement).

## Learnings

- In zod v4, `ctx.path` is removed from `superRefine` callbacks but specifying `path` in `ctx.addIssue()` still routes errors to the correct field.
- `@hookform/resolvers` v5+ has zod v4 auto-detection — just use `zodResolver(schema)` as normal.
- TanStack Router typed search params: adding `validateSearch` to a route makes the `Link` component's `search` prop required everywhere that links to that route. Fix: pass the full search shape (e.g., `search={{ from: undefined }}`).

## Files / Surfaces

- `web/package.json` — added `react-hook-form ^7.77.0`, `@hookform/resolvers ^5.4.0`
- `web/src/features/workflows/WorkflowDraftSchema.ts` — new: schema, types, blankWorkflow, workflowDocToFormData, toWorkflowPayload
- `web/src/features/workflows/useWorkflow.ts` — new: TanStack Query hook for GET /workflows/:name
- `web/src/features/workflows/EdgesField.tsx` — new: nested edge field array subcomponent
- `web/src/features/workflows/StepFields.tsx` — new: step fields subcomponent
- `web/src/features/workflows/WorkflowEditor.tsx` — new: main form component (create + edit modes)
- `web/src/features/workflows/WorkflowDraftSchema.test.ts` — new: unit tests for schema validation
- `web/src/features/workflows/WorkflowEditor.test.tsx` — new: component + integration tests
- `web/src/router.tsx` — replaced placeholders with NewWorkflowPage + EditWorkflowPage; added validateSearch for from param
- `web/src/features/workflows/WorkflowList.tsx` — updated Link to pass `search={{ from: undefined }}`

## Errors / Corrections

- `require()` inside inline React components does not work in the Vitest/jsdom environment. Used top-level ESM imports instead.
- zod v4 `superRefine` `ctx.path` removed — but `path` in `addIssue` args still works fine.

## Ready for Next Run

task_09 (Agent/model picker) can import `WorkflowEditor`, `StepFields`, and the `useWorkflow` hook. It replaces the plain agent/model `Input` components in `StepFields.tsx` with a combobox backed by `useIdeCatalog`.
