# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Build dashboard feature: `useRuns` TanStack Query hook + `RunsTable` component with status styling, all-runs toggle, empty states, and row navigation.

## Important Decisions

- Added `/runs/$runId` placeholder route to `router.tsx` so `Link to="/runs/$runId"` is type-safe. Task_11 will replace the placeholder component with the real run view.
- `useRuns` always fetches (no `enabled` guard) regardless of activeCwd; component renders `no-cwd-state` early when cwd is absent — hooks are not conditional.
- `refetchInterval: 2000` set directly on the query; `defaultOptions.queries.refetchInterval: false` in test QueryClient does NOT override per-query settings in TanStack Query v5.

## Learnings

- TanStack Router v1: `Link` type is checked against `Register.router` at compile time; runtime router (test-specific) just needs the same routes at runtime. Safe to create test-specific `routeTree` using `createRootRoute`/`createRoute` inside test helpers.
- For integration tests of components that use `Link`, create a test-specific router that includes both the index route (mounting the component under test) and the destination route (for navigation assertion). Do NOT use the production `router` directly.
- `renderHook` wrapper only needs `QueryClientProvider`; Zustand stores are global and need no provider.
- Background refetch interval of 2000ms does not cause test failures: tests complete before the first refetch fires, and `cleanup()` in `afterEach` unmounts the component stopping the timer.

## Files / Surfaces

- `web/src/features/dashboard/useRuns.ts` — new, TanStack Query hook
- `web/src/features/dashboard/RunsTable.tsx` — new, table component
- `web/src/features/dashboard/useRuns.test.tsx` — new, hook unit tests
- `web/src/features/dashboard/RunsTable.test.tsx` — new, component integration tests
- `web/src/router.tsx` — added `/runs/$runId` placeholder route

## Status

Complete. 116 tests pass, 98.54% stmts / 92.74% branches / 97.1% funcs / 98.36% lines. TypeScript clean.
