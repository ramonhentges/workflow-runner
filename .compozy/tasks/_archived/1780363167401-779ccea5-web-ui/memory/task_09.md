# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Build `web/src/features/start-run/`: `useWorkflows` query hook + `StartRunForm` component + full test suite. The `/start` route is wired in task_11; this task delivers the self-contained form and hooks.

## Important Decisions

- Use native `<select>` for the workflow picker (no Radix Select available — same constraint as task_07).
- `selectedPath` (picker) and `manualPath` (text input) are two controlled state vars; they clear each other on update. Final `workflowPath = selectedPath || manualPath.trim()`.
- `useWorkflows` is `enabled: activeCwd !== null` so no fetch fires without a cwd.
- On `startRun` success: invalidate `['runs']` query key (covers all cwd/all variants) then navigate to `/runs/$runId`.
- Test setup: same `renderForm` helper pattern as `RunsTable.test.tsx` (createMemoryHistory + createRouter with `/start` + `/runs/$runId` routes).
- `useWorkflows` unit tests use `renderHook` + `QueryClientProvider` only (no router needed).

## Learnings

- `mutation.error` in TanStack Query v5 is `Error | null`; use `error instanceof Error ? error.message : 'Failed'` to avoid explicit casts.
- `useNavigate()` from TanStack Router requires a router context, so even "unit" form rendering tests need a test router.

## Files / Surfaces

- `web/src/features/start-run/useWorkflows.ts` (new)
- `web/src/features/start-run/StartRunForm.tsx` (new)
- `web/src/features/start-run/StartRunForm.test.tsx` (new)

## Errors / Corrections

## Ready for Next Run

Task complete. All 15 new tests pass, 131 total. Coverage 98.75% stmts. Diff is staged and ready for manual review/commit. task_11 (routing + shell) is the next dependent task.
