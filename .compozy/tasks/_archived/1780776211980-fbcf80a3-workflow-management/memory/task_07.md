# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Implement the web Workflows list page for active-cwd workflow discovery, create/edit navigation, and run-aware delete handling; keep scope to task_07 and leave editor implementation to task_08.
- Implementation complete: list page, hook, route/nav, delete handling, and tests are in place pending final post-tracking verification.

## Important Decisions
- List API returns filenames such as `flow.json`, while CRUD routes use bare names. The workflows feature should derive a bare name by stripping a trailing `.json` for edit/delete route params and display a filename-derived label.
- Use an inline confirmation state with existing `Button` primitives instead of adding a dialog dependency for task_07.
- Added real `/workflows/new` and `/workflows/$name/edit` routes with a small placeholder component so task_07 navigation is type-safe; task_08 should replace the placeholder with the actual editor.

## Learnings
- `AGENTS.md` is not present in this repo root; `CLAUDE.md` plus PRD/TechSpec/ADRs are the available repo guidance.
- `rg` is unavailable in the environment, so file/text discovery used `find`/`grep`.
- Baseline pre-change signal: `bun test web/src/features/workflows/WorkflowList.test.tsx` found no matching test file because the workflows feature module does not exist yet.
- Repo root `bun test <web path>` does not load the web Vitest/jsdom config; use web-local `bunx vitest run ...` or `bun run test` from `web/` for frontend tests.

## Files / Surfaces
- Touched: `web/src/features/workflows/WorkflowList.tsx`, `useWorkflowList.ts`, `workflowNames.ts`, `WorkflowList.test.tsx`, `web/src/router.tsx`, `web/src/app/AppShell.tsx`, `web/src/__tests__/App.test.tsx`, `web/src/__tests__/routing.test.tsx`, and workflow-management tracking/memory files.

## Errors / Corrections
- Initial focused `bun test ./web/src/features/workflows/WorkflowList.test.tsx` failed because it ran outside the web Vitest config and had no `document`; reran with `bunx vitest run ...` from `web/`, which passed.

## Ready for Next Run
- Task_08 should replace `WorkflowEditorPlaceholder` in `web/src/router.tsx` for `/workflows/new` and `/workflows/$name/edit`.
