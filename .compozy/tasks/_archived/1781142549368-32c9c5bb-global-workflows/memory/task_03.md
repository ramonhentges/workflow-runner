# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Done + verified (uncommitted): `GET /workflows` now returns one combined array of project + global items, each tagged `scope`. typecheck clean, full suite 1041 pass / 0 fail.

## Important Decisions

- No-`cwd` is no longer a `400 MISSING_CWD` for the **list** route — it returns `200` with global-only items (per task requirement + test plan). `MISSING_CWD` was removed from `workflows.ts` entirely; the `400` response now documents only `INVALID_CWD` (project ENOTDIR/EACCES). CRUD routes keep their `MISSING_CWD` behavior.
- Global read degrades to empty on ENOENT **and** ENOTDIR/EACCES (never errors), satisfying "missing global dir → empty, never an error".

## Learnings

- List tests must isolate the global dir: handler always reads `resolveGlobalWorkflowsDir()` (live `process.env`). Set `process.env.XDG_STATE_HOME` to a temp root in `beforeEach`/restore in `afterEach` so project-only assertions stay deterministic.
- `Workflow.fromJson` requires `version` + per-step `model`/`edges`; minimal POST fixture needs them or returns `400 WORKFLOW_INVALID`.

## Files / Surfaces

- `src/app/api/routes/workflows.ts` — rewrote handler; added `readScopedWorkflows(dir, scope)` reader used for both scopes.
- `src/app/api/routes/workflows.test.ts` — XDG fixture, combined-scope unit block, `POST ?scope=global` integration test; updated old MISSING_CWD tests to 200-global expectations.

## Errors / Corrections

## Ready for Next Run

- List contract is final: project items only when `cwd` present; globals always; same-name across scopes yields two items distinguished by `scope`. task_05 web hook consumes this combined shape directly.
