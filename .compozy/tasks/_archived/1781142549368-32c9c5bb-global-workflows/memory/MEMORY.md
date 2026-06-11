# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- task_01 done (uncommitted): `scope` schema + `resolveGlobalWorkflowsDir`/`resolveScopedWorkflowsDir` helpers in place. `WorkflowItemSchema.scope` is now **required** — any code emitting workflow items must tag scope.
- task_02 done + verified (uncommitted): four CRUD handlers scope-aware via `resolveScopeTarget`/`resolveScopedWorkflowsDir`; per-scope 409, global run-guard, path-traversal, atomic writes all preserved; every CRUD response carries resolved `scope`.
- task_03 done + verified (uncommitted): `GET /workflows` returns one combined array of project (only when `cwd`) + global (always) items, each tagged `scope`. Full suite green (1041 pass).
- task_04 done + verified (uncommitted): web API layer mirrors scope. `web/src/lib/api/types.ts` adds `WorkflowScope = 'global'|'project'` + `scope` on `WorkflowItem`; the four CRUD helpers now take `(cwd, scope, ...)` and send an explicit `scope` query param. `listWorkflows` unchanged. Web suite green (414 pass, 94% cov). Helper sig change forced minimal `'project'` compile-fixes (with `TODO(task_05/06)`) in `useWorkflow.ts`, `WorkflowEditor.tsx`, `WorkflowList.tsx` — task_05/06 must replace these with real scope.

## Shared Decisions

- `resolveScopedWorkflowsDir(scope, cwd, env)` in `workflow-crud.ts` is the single source of truth for scope→dir selection; CRUD (task_02) and list (task_03) must route through it rather than calling `resolveWorkflowsDir(cwd)` directly.
- Scope discriminator `"global" | "project"`; the `scope` query field is optional and defaults to `"project"` when omitted (ADR-003, back-compat). Global dir = `(XDG_STATE_HOME ?? ~/.local/state)/workflow-runner/workflows` (ADR-002); project scope without `cwd` throws `WorkflowConfigError`.
- **List vs CRUD on no-`cwd` diverge**: the **list** route (`workflows.ts`) treats absent `cwd` as "global-only, 200" (no `MISSING_CWD`); the **CRUD** routes still emit `400 MISSING_CWD` for project scope without `cwd`. The list `400` now only covers project `INVALID_CWD` (ENOTDIR/EACCES). Global reads never error (ENOENT/ENOTDIR/EACCES all → empty).

## Shared Learnings

- Verification gate: `bun run typecheck` + `bun test` (full suite, ~30s, 64 files). Tests are co-located `*.test.ts`.

## Open Risks

## Handoffs

- task_04 web: DONE — mirrored the `scope` contract in `web/src/lib/api/types.ts`; the list endpoint returns a single combined array (project+global), consumed unchanged.
- task_05 web hooks: DONE + verified (uncommitted). `useWorkflow.ts` now has scope-aware detail hook (`workflowQueryKey(cwd,scope,name)`, `useWorkflow(name, scope='project')`) plus three mutation hooks `useCreateWorkflow`/`useUpdateWorkflow`/`useDeleteWorkflow` — each takes `{scope,...}`, forwards to the task_04 helper, invalidates `workflowListQueryKey(cwd)`. Hooks-layer only; components NOT touched (task spec puts WorkflowEditor.tsx in task_07, WorkflowList.tsx in task_06 — this supersedes task_04's earlier note that assigned WorkflowEditor create/update to task_05). Web suite 422 pass, 93.98% cov.
- task_06 web list: DONE + verified (uncommitted). `WorkflowList.tsx` renders a per-row scope `Badge` (Global=`secondary`/Project=`outline`), keys rows by `scope+name`, delete via `useDeleteWorkflow({scope: workflow.scope, name})` with per-call `mutate` callbacks for confirm-reset/error. Edit `<Link>` carries `search={{scope}}`; `router.tsx` `editWorkflowRoute` gained `validateSearch` parsing optional `scope` (unknown→`project`) — **task_07 should consume `editWorkflowRoute.useSearch().scope`** into `useWorkflow(name, scope)` + read-only badge instead of re-adding it. Web suite 427 pass, 93.96% stmt cov. Row `data-testid` stays bare-name (not scope-qualified) for back-compat.
- task_07 web editor: DONE + verified (uncommitted). `WorkflowEditor.tsx` now uses task_05 hooks `useCreate/UpdateWorkflow` (navigation/error via per-call `mutate` callbacks); create shows a `Button`-group Global/Project toggle (default Project, `scope-toggle*` testids) wiring `scope` into the create mutation; edit shows a read-only `Badge` (`scope-badge`) and sends the unchanged scope on PUT. Scope is editor `useState`, **not** in `WorkflowDraftSchema`/`toWorkflowPayload` (derived from location, ADR-003 — schema untouched). `router.tsx` `EditWorkflowPage` threads `editWorkflowRoute.useSearch().scope` into `useWorkflow(name, scope)` + `<WorkflowEditor scope>`. Web suite 433 pass, 94% stmt cov.
- Web verification gate runs from `web/`: `bun run typecheck` + `bun run test` (vitest --coverage, GLOBAL 80% threshold — must run the FULL web suite, a single file fails the global threshold).
- task_08 web start-run picker: DONE + verified (uncommitted). `StartRunForm.tsx` adds a per-option scope `Badge` (Global=`secondary`/Project=`outline`, `workflow-scope-badge`/`data-scope`) inside the Radix `SelectItem`; start payload unchanged (`wf.path` + active cwd, global items included). `useWorkflows.ts` left untouched (already consumes the combined scoped list). **Gotcha:** a Badge inside a Radix `SelectItem` folds its text into the option's accessible name, so exact `getByRole('option',{name:'x.json'})` matchers break — use regex. This broke `web/src/__tests__/routing.test.tsx` too (fixed). Web suite 435 pass, 94.01% stmt cov.
