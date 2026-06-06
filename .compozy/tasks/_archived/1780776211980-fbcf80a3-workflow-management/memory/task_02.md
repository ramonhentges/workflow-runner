# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement a pure `findActiveRunForWorkflow(snapshots, workflowPath)` helper that returns `RunId | null`. Placed in `src/app/api/routes/workflow-run-guard.ts` — colocated with the future CRUD routes directory.

## Important Decisions

- **Return type is `RunId | null`** (not `boolean`) — allows callers to include the blocking run's ID in error messages.
- **Placement**: `src/app/api/routes/workflow-run-guard.ts` — colocated with CRUD routes per TechSpec guidance; task_03 imports from here.
- **Pure function over snapshot list**: Takes `RunSnapshot[]` directly, not a `RunManager` — the caller (`workflow-crud.ts` in task_03) calls `RunManager.list({ includeOldTerminal: true })` and passes the result.

## Learnings

- `makeSnap` helper in tests: do NOT spread `Partial<RunSnapshot>` as a final spread — it overwrites branded types (RunId) with plain strings. Destructure only the needed fields explicitly.
- `asRunId` / `asRunSlug` are cast-only functions; TypeScript still enforces branded types in spreads.

## Files / Surfaces

- Created: `src/app/api/routes/workflow-run-guard.ts`
- Created: `src/app/api/routes/workflow-run-guard.test.ts`
- No existing files modified.

## Errors / Corrections

- Initial test `makeSnap` used `...overrides` spread which overwrote `id: asRunId(...)` with `overrides.id: string`. Fixed by not spreading `Partial<RunSnapshot>` — instead accept only the specific fields needed.

## Ready for Next Run

task_03 should import `findActiveRunForWorkflow` from `./workflow-run-guard.js` and call it after resolving the absolute workflow path with `RunManager.list({ includeOldTerminal: true })`.
