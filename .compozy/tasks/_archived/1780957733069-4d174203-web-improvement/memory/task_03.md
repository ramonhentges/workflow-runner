# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Migrate `web/src/features/dashboard/RunsTable.tsx` to shadcn `Table` with GitHub-Actions-style icon-first rows: columns status → workflow → current step → started → duration. Status via `StatusBadge` (icon-only). Done + verified (327 tests green, coverage 93.66%).

## Important Decisions

- Columns are exactly the 5 required: status → workflow → current step → started → duration. Dropped the old `slug`, `ended`, and `attachedCount` columns (slug + workflow merged into one cell; ended folded into derived duration; attachedCount has no spot in the GH-Actions layout / no IDE column per ADR-002).
- Workflow cell holds the run link (slug, mono) as primary text + workflow filename as muted subtext. This keeps the slug both visible and clickable so the navigation test (`findByRole('link',{name:slug})`) stays valid with zero churn.
- Duration: unfinished runs (`endedAt === null`) render `—` (not "in progress"); the task allowed either. Keeps the dash-count test natural (null currentStep + unfinished duration both → `—`).
- `formatDuration(startedAt, endedAt)` lives inline in `RunsTable.tsx` (not lib/utils) — single consumer, no reuse yet.

## Learnings

- shadcn `table` primitive is plain HTML (no Radix) → no new jsdom shims needed (unlike the upcoming Select tasks).
- Status assertion pattern for icon-only `StatusBadge`: query `[data-slot="badge"][data-status="..."]` and/or `getByLabelText('<Label>')` (capitalized meta.label). `queryByText('<status>')` (lowercase raw status) is now absent — that's the "not a raw color-class span" proof.
- `bun run vitest run <file>` works for fast single-file iteration before the full `bun run test` coverage gate.

## Files / Surfaces

- `web/src/components/ui/table.tsx` — NEW, via `yes N | bunx shadcn@latest add table` (from `web/`).
- `web/src/features/dashboard/RunsTable.tsx` — rewritten on shadcn Table; removed `statusClass()`; added `formatDuration()`.
- `web/src/features/dashboard/RunsTable.test.tsx` — restructured: added table-structure/duration/loading/error tests; updated status assertions to StatusBadge; dropped ended/attachedCount assertions.

## Errors / Corrections

(none)

## Ready for Next Run

- Task 04 (status summary cards + URL filter) builds on this list: cards `navigate({ search: { status }})`; the list will need to read the `?status=` param to filter. The `All runs` toggle stays as-is alongside the new filter.
