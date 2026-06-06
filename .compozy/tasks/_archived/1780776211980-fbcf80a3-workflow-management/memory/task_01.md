# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented API schemas and error codes as the foundational contract for all downstream CRUD and catalog tasks.

## Important Decisions

- `WorkflowNameParamSchema` uses `.refine()` (not regex) for the three-part guard: no `/`, no `\`, no `..`. Simpler and more readable than a complex regex.
- `workflow` field in create/update/doc schemas is typed `z.unknown()` — domain layer validates via `Workflow.fromJson` (per ADR-004 and techspec).
- `IdeCatalogEntrySchema` is unexported (internal to schema.ts) since only `IdeCatalogSchema` is consumed externally.
- New error codes `WORKFLOW_RUN_ACTIVE: -32008` and `WORKFLOW_EXISTS: -32009` continue the existing `-320xx` sequence.
- Error-map tests were placed in a new `error-map.test.ts` (not in schema.test.ts) to keep concerns separated.

## Learnings

- `RunManagerError` constructor signature: `new RunManagerError("KEY_NAME", "message")` — takes the string key of `RpcErrorCode`, not the numeric value.
- Existing test pattern: use `safeParse` with `.success` checks; only unwrap `result.data` inside a `if (result.success)` guard.
- `bun test` picks up all `*.test.ts` under `src/` (configured in `bunfig.toml`).

## Files / Surfaces

- `src/app/api/schema.ts` — added 6 new exported schemas + types (lines 126–176)
- `src/infra/daemon/protocol.ts` — added WORKFLOW_RUN_ACTIVE (-32008) and WORKFLOW_EXISTS (-32009) to RpcErrorCode
- `src/app/api/error-map.ts` — mapped both new codes to HTTP 409
- `src/app/api/schema.test.ts` — added ~90 lines of tests for new schemas
- `src/app/api/error-map.test.ts` — new file; 10 tests for error mapping

## Errors / Corrections

None.

## Ready for Next Run

- task_02 (run-active guard) can start; uses `RunManagerError("WORKFLOW_RUN_ACTIVE")` from protocol.ts.
- task_03 (CRUD routes) can import `WorkflowNameParamSchema`, `WorkflowCreateBodySchema`, `WorkflowUpdateBodySchema`, `WorkflowDocSchema` from `schema.ts`.
- task_05 (catalog route) can import `IdeCatalogParamSchema`, `IdeCatalogSchema` from `schema.ts`.
- task_06 (web types) can mirror `WorkflowDoc`, `WorkflowCreateBody`, `WorkflowUpdateBody`, `IdeCatalog` shapes.
