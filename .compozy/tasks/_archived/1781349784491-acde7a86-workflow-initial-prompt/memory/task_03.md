# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Done. HTTP layer threads `initialPrompt`: accepted on `POST /runs`, forwarded to
`startRun`, and exposed on `GET /runs/:id` (RunDetail). `ps`/RunSummary unchanged.

## Important Decisions

- Server schema uses plain `z.string().optional()` (no trim/min) per techspec —
  blank-dropping is the caller's job (web/CLI). A non-string is rejected 400.

## Learnings

## Files / Surfaces

- `src/app/api/schema.ts` — `initialPrompt` added to `StartRunRequestSchema` and
  `RunDetailSchema` only (NOT `RunSummarySchema`).
- `src/app/api/routes/start-run.ts` — destructure + forward as 4th `startRun` arg.
- `src/app/api/routes/run-detail.ts` — map `snap.initialPrompt` into response.
- Tests: `start-run.test.ts` (forward present/absent, non-string→400),
  `run-detail.test.ts` (integration: present when started with prompt, absent
  otherwise). `StartRunFn` mock type widened with `initialPrompt?`.

## Errors / Corrections

## Ready for Next Run

Task 05/06 web client (`web/src/lib/api/types.ts`) mirrors these schemas: add
`initialPrompt?` to `StartRunRequest` and `RunDetail` web types.
