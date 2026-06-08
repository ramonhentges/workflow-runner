# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Five status summary cards above the runs list, counts derived client-side from the existing `useRuns` poll; Failed card emphasized when >0; click-to-filter via typed `?status=` URL param on the index route (ADR-003).

## Important Decisions

- `RUN_STATUSES` const + `parseStatus()` live in `lib/api/types.ts`; `RunStatus` derived from the const for a single source. Both router and cards import from there (avoids a router↔feature import cycle).
- `RunsTable` reads the param with `useSearch({ strict: false })` + `parseStatus` so it stays usable in standalone test routers (not coupled to `indexRoute.id`).
- `StatusSummaryCards` is rendered INSIDE `RunsTable` (above the list); index route component stays `RunsTable`, only gaining `validateSearch`.
- Cards call `useRuns()` (default all:false) → same query key as RunsTable default → React Query dedupes, one fetch.
- Each card: shadcn `Card` wrapper (p-0) + inner `<button>` (testid/aria-pressed/onClick) so the whole card is one accessible control.

## Learnings

- Cards render zeros first (useRuns loading → data=[]) then re-render on poll resolve; count assertions must await data (`await within(card).findByText('2')`) before reading other cards synchronously.
- `useSearch({ strict: false })` returns the *validated* search when the route has `validateSearch`, raw otherwise; casting `as { status?: unknown }` + `parseStatus` works in both real and standalone test routers.
- shadcn `Card` is a plain div (no `asChild`); clickable card = `Card` wrapper (`p-0`) + inner `<button>` carrying testid/aria-pressed/onClick.
- `lib/api/client.ts` has its own `RunStatusSchema = z.enum([...])` duplicating the five statuses — left as-is (out of scope); could later derive from `RUN_STATUSES`.

## Files / Surfaces

- `web/src/lib/api/types.ts`, `web/src/router.tsx`, `web/src/features/dashboard/StatusSummaryCards.tsx` (new), `web/src/features/dashboard/RunsTable.tsx`
- Tests: `StatusSummaryCards.test.tsx` (new), `RunsTable.test.tsx`, `__tests__/routing.test.tsx`

## Errors / Corrections

## Ready for Next Run

- Task 04 DONE & verified: typecheck clean, 340 tests green, coverage 94%/84%. Cards + `?status=` filter shipped.
- For Task 10 (skeletons/empty states): `RunsTable` now also has `no-filtered-runs-state` (runs exist but filter matches none) alongside `no-cwd-state`/`no-runs-state`/`loading-state`/`error-state`.
- `RUN_STATUSES` + `parseStatus` (in `lib/api/types.ts`) are the reusable status whitelist for any future status-driven UI.
