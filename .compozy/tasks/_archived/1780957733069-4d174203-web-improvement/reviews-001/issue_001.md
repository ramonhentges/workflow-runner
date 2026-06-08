---
provider: manual
pr:
round: 1
round_created_at: 2026-06-08T13:21:13Z
status: resolved
file: web/src/features/dashboard/StatusSummaryCards.tsx
line: 37
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Card counts diverge from runs list when "All runs" is on

## Review Comment

`StatusSummaryCards` always queries `useRuns()` — query key
`['runs', { cwd, all: false }]` (StatusSummaryCards.tsx:37) — while `RunsTable`
queries `useRuns({ all: allRuns })` (RunsTable.tsx:36). The daemon's `all`
parameter maps to `includeOldTerminal` (see `src/infra/daemon/handlers/run-ps.ts`),
so toggling the "All runs" button surfaces older terminal runs in the table that
the cards never count.

The result is a trust/consistency gap on the flagship dashboard: with "All runs"
enabled, the Failed card may read `2` while clicking it filters the table to,
say, 20 failed rows. This undermines the PRD's "glanceable health / trust" goal
and the "≤ 2-click triage" promise — the count the user glances at no longer
matches the rows they land on. (Within the default view the two queries share a
key and stay consistent; the divergence only appears in the non-default
"All runs" mode, hence medium rather than high.)

Suggested fix: share a single `all` scope between the cards and the list. For
example, lift the `allRuns` toggle into the URL search param (alongside
`status`) so both `StatusSummaryCards` and `RunsTable` read the same scope and
issue the same query, keeping counts and rows derived from one dataset.
Alternatively, scope the cards to the active `all` value passed down from the
table. There is currently no test covering the All-runs + card-count
interaction.

## Triage

- Decision: `VALID`
- Severity: medium (confirmed)

### Root cause

`RunsTable` owns the "All runs" toggle as local state and queries
`useRuns({ all: allRuns })` (RunsTable.tsx:36), but the nested
`StatusSummaryCards` independently calls `useRuns()` with no argument, which
`useRuns` defaults to `all: false` (useRuns.ts:9). The two components therefore
key on different React Query entries (`['runs', { cwd, all:false }]` vs
`['runs', { cwd, all:true }]`) and fetch different datasets once "All runs" is
enabled. The daemon maps `all` to `includeOldTerminal`, so the table surfaces
older terminal runs the cards never count — the glanced count no longer matches
the rows a card click lands on.

In the default view both queries share `all:false`, so they stay consistent; the
divergence only appears in the non-default "All runs" mode, matching the medium
severity.

### Fix approach

Share a single `all` scope between the cards and the list. I implemented the
"scope the cards to the active `all` value passed down from the table" option
(the reviewer's second suggestion) because it is the minimal change:

- `StatusSummaryCards` now accepts an optional `all` prop (default `false`) and
  forwards it to `useRuns({ all })`, so it issues the same query key as the
  table.
- `RunsTable` passes its `allRuns` toggle value down as `<StatusSummaryCards
  all={allRuns} />`.

The one-line `RunsTable.tsx` change is outside the listed code-file scope but is
unavoidable: the cards can only mirror the table's scope if the table supplies
it. Keeping the toggle as the single source of `all` (rather than duplicating it
or moving it to the URL) confines the cross-file edit to a single prop pass and
keeps both components reading one dataset.

### Tests

- `StatusSummaryCards.test.tsx`: assert the `all` prop drives `all=true` on the
  runs request, and that the default (no prop) omits it.
- `RunsTable.test.tsx`: integration test proving the Failed card count equals the
  rendered failed-row count after enabling "All runs" against a larger
  all-runs dataset.
