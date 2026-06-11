# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Done. The four CRUD handlers (`GET/POST/PUT/DELETE /workflows/:name`) are scope-aware:
read `scope` from query (default `project`), resolve dir via `resolveScopedWorkflowsDir`,
return resolved `scope` in every response. Per-scope 409, run-active guard, path-traversal
safety, atomic writes all preserved.

## Important Decisions

- Extracted `resolveWorkflowFileInDir(dir, name)` to carry the containment guard against an
  already-resolved dir; `resolveWorkflowFile(cwd, name)` is now a thin delegating wrapper
  (public contract + tests unchanged). Handlers use the dir-based variant.
- Added a private `resolveScopeTarget(scope, cwd)` helper returning `{ok,scope,dir}` or
  `{ok:false}`; `ok:false` only happens for project scope without cwd → handler emits
  `MISSING_CWD`. Keeps the MISSING_CWD-vs-WORKFLOW_INVALID distinction (resolveScopedWorkflowsDir
  would otherwise throw WorkflowConfigError → 400 WORKFLOW_INVALID, wrong code).
- `WorkflowDocSchema` gained a **required** `scope` field; DELETE response now `{deleted, scope}`.

## Learnings

- Route handlers call `resolveScopedWorkflowsDir` with the default `env = process.env`, so
  global-scope tests must set/restore `process.env.XDG_STATE_HOME` (not an injected env arg).
  Fixture `makeTempGlobalState()` does this and restores prev value on cleanup.
- Run-active guard already covers global: `findActiveRunForWorkflow` does `resolve(cwd ?? "", path)`;
  an absolute global path resolves to itself, so it matches regardless of cwd.

## Files / Surfaces

- `src/app/api/routes/workflow-crud.ts` — handlers + `resolveWorkflowFileInDir` + `resolveScopeTarget`.
- `src/app/api/schema.ts` — `WorkflowDocSchema.scope` (required).
- Tests: `workflow-crud.test.ts` (global-scope, default-scope, global run-guard suites + fixture),
  `workflow-run-guard.test.ts` (global absolute-path unit case), `schema.test.ts` (scope on doc).

## Errors / Corrections

None.

## Verification

- `bun run typecheck` → exit 0 (no errors). `bun test` → 1036 pass / 1 skip / 0 fail (64 files).
  Verified this session; implementation was already in place (uncommitted) and confirmed complete
  line-by-line against task requirements. Not committed (`--auto-commit=false`).

## Ready for Next Run

- task_03 (list merge) must also return `scope` per item and read the global dir; `WorkflowDocSchema`
  pattern (required scope) confirms the contract. `workflows.ts` still stubs `scope:"project"`.
