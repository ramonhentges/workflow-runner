# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

task_01 through task_09 complete. API schemas, error codes, run-active guard, CRUD routes, `probeIdeCatalog`, `GET /ide/:ide/catalog?cwd=`, web API client functions/wire types, WorkflowList (task_07), and WorkflowEditor create/edit form (task_08) are live.

## Shared Decisions

- `workflow` payload is always `z.unknown()` at the API schema layer — `Workflow.fromJson` is the sole structural validator (domain layer).
- `WorkflowNameParamSchema` in `schema.ts` is the single source of truth for bare-name validation (no `/`, `\`, `..`). All CRUD routes and the web editor must reuse it.
- New RpcErrorCode sequence: WORKFLOW_RUN_ACTIVE = -32008, WORKFLOW_EXISTS = -32009. Next code would be -32010.
- `RunManagerError` constructor takes the string key (e.g. `"WORKFLOW_RUN_ACTIVE"`), not the numeric value.

## Shared Learnings

- `bun test` runs all `*.test.ts` under `src/` via `bunfig.toml` (no extra config needed for new test files).

## Shared Learnings (continued)

- Hono `createRoute` response map must include every HTTP status the handler can return; TypeScript enforces this at compile time.
- `RunSnapshot` in test fixtures requires a `kickoffPrompts: {}` field (discovered during task_03 test writing).
- In-place PUT (no rename) does NOT trigger the run-guard — only rename and delete are identity-changing operations requiring the guard.

## Open Risks

- Concurrent workflow edits: ADR-004 notes this is acceptable for a single-user tool. Atomic writes (temp + rename) are implemented in task_03 and must be reused if any future task writes workflow files.

## Handoffs

- task_01 → task_02: `RunManagerError("WORKFLOW_RUN_ACTIVE")` is live; implement the guard helper. ✓ done
- task_02 → task_03: `findActiveRunForWorkflow(snapshots, workflowPath)` exported from `src/app/api/routes/workflow-run-guard.ts`. Returns `RunId | null`. Call with `RunManager.list({ includeOldTerminal: true })` output and the resolved absolute workflow path.
- task_01 → task_03: CRUD schemas exported from `schema.ts`; implement route handlers. ✓ done
- task_03 → task_05/task_06: `GET /workflows/:name`, `POST /workflows`, `PUT /workflows/:name`, `DELETE /workflows/:name` are live and tested. `resolveWorkflowFile` and `writeJsonAtomic` exported from `workflow-crud.ts` if needed internally.
- task_01 → task_05: Catalog schemas exported from `schema.ts`; implement probe route.
- task_04 → task_05: `probeIdeCatalog(ide, cwd, opts?)` exported from `src/infra/acp/ide-catalog.ts`. Throws `UnknownIdeError` for unknown `ide` (route → 400). Returns `{ reachable, agents, models, reason? }` — `reachable:false` is a normal 200. `disposeProcess` handles `kill()` returning false (process already gone). ✓ done
- task_05 → task_06/task_09: `GET /ide/:ide/catalog?cwd=` is registered in the API and documented in OpenAPI. It returns 400 `MISSING_CWD` for missing/empty `cwd`, 400 `UNKNOWN_IDE` for `UnknownIdeError`, and 200 for both reachable and unreachable catalog envelopes.
- task_01 → task_06: Wire types mirror `WorkflowDoc`, `WorkflowCreateBody`, `WorkflowUpdateBody`, `IdeCatalog` from `schema.ts`. ✓ done
- task_06 → task_07/task_08/task_09: web exports `getWorkflow`, `createWorkflow`, `updateWorkflow`, `deleteWorkflow`, `getIdeCatalog`, plus matching wire types. Workflow CRUD URLs use bare encoded names and `cwd` query params; `deleteWorkflow` returns `{ deleted: string }`.
- task_07 → task_08: `/workflows/new` and `/workflows/$name/edit` are registered in `web/src/router.tsx` with a placeholder component. Replace the placeholder with the real editor; `WorkflowList` links pass bare names derived from list filenames by stripping trailing `.json`. ✓ done
- task_08 → task_09: `WorkflowEditor`, `StepFields`, `EdgesField`, `WorkflowDraftSchema`, `useWorkflow` are live. task_09 replaces plain agent/model `Input` in `StepFields.tsx` with a catalog-backed combobox. Note: TanStack Router `validateSearch` on `/workflows/new` makes Links to that route require `search={{ from: undefined }}` — already applied to `WorkflowList.tsx`.
- task_08 → task_09 (zod v4 note): In zod v4 `superRefine`, `ctx.path` (reading) is removed; `path` in `ctx.addIssue()` still works for setting per-field error paths. `@hookform/resolvers` v5+ auto-detects zod v4.
- task_09 → task_10: `useIdeCatalog`, `AgentModelPicker` (datalist-based combobox), and `StepFields` with catalog integration are live. `AgentModelPicker` uses HTML `<input list=...>` + `<datalist>` — no extra deps. Query key is `['ide-catalog', cwd, ide]`; keyed on `ide` change not agent/model text. task_10 only requires docs update.
