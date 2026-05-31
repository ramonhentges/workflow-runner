# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented `GET /runs/:id/events` — a read-only HTTP endpoint for historical event pulls with `fromSeq`/`stepId` filtering. Status: complete.

## Important Decisions

- Mirrored the `run-attach.ts` `ownedEventLog` pattern exactly: `!active.eventLog` → call `rm.openEventLog`, own and close in `finally`; running run uses shared `active.eventLog`, not closed.
- `stepId` filter applied in-handler (`entries.filter(e => e.stepId === stepId)`) after `readEventsSince`; `truncated` propagated as-is even after stepId narrowing.
- Used `try/finally` for owned log close (mirrors attach handler pattern).
- For truncation unit test: used a `makeControlledLog` mock returning `truncated: true` (can't create 10,000+ entries in a unit test).
- Behavioral tests (fromSeq, stepId) used a real `EventLog` opened in a temp dir and passed as `activeEventLog` (simulates running run — handler won't close it).

## Files / Surfaces

- `src/app/api/routes/run-events.ts` — new route handler
- `src/app/api/routes/run-events.test.ts` — 16 tests (all pass)
- `src/app/api/app.ts` — registered `registerRunEventsRoute`

## Learnings

- `async () => { counter++; }` — the increment runs synchronously inside the async function body before the returned Promise resolves. No setTimeout needed in FD-leak tests.
- `EventLog.append()` syncs to disk per entry. Ring buffer fast-path in `readEventsSince` makes behavioral unit tests work with small entry counts without flushing.

## Errors / Corrections

None.

## Ready for Next Run

Task complete. 608 pass, 0 fail. Diff left unstaged for manual review (auto-commit disabled).
