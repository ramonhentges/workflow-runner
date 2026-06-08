---
provider: manual
pr:
round: 1
round_created_at: 2026-06-08T13:21:13Z
status: resolved
file: web/src/app/AppShell.tsx
line: 31
severity: low
author: claude-code
provider_ref:
---

# Issue 004: DaemonStatus uses ad-hoc bg-green-500/bg-red-500 colors

## Review Comment

`DaemonStatus` colors its indicator dot with raw Tailwind palette classes —
`bg-green-500` / `bg-red-500` (AppShell.tsx:31-35). The PRD explicitly targets
removing "ad-hoc color strings" in favor of semantic tokens that are tuned for
legibility in both light and dark themes. Unlike the run-status tokens defined
in `index.css` (`--status-*`, themed for `:root` and `.dark`), these raw `500`
shades are not part of the token system and are not lightness-adjusted per
theme.

This is minor — the dot remains readable and daemon-health is conceptually
distinct from the five run statuses — so it is low severity, not a blocker. But
it is a residual inconsistency against the "single color system / no ad-hoc
strings" goal.

Suggested fix: map the online/offline/connecting states to semantic tokens
(reuse `--status-completed` / `--status-failed` / `--muted-foreground`, or add
dedicated `--status-online` / `--status-offline` tokens to `index.css` with
light/dark values) and reference them via the `text-status-*` / `bg-status-*`
utilities, matching how `StatusBadge` consumes the token system.

## Triage

- Decision: `VALID`
- Root cause: `DaemonStatus` in `AppShell.tsx` colors its indicator dot with raw
  Tailwind palette classes (`bg-green-500` / `bg-red-500`). These are outside
  the `--status-*` semantic token system (`index.css`) that is themed per
  `:root` / `.dark` and exposed via `bg-status-*` utilities (`@theme inline`
  block). They are the exact "ad-hoc color strings" the PRD targets and are not
  lightness-adjusted per theme. The `connecting` state already used a semantic
  token (`bg-muted-foreground/40`), so only the online/offline shades drift.
- Fix approach: Reuse the existing semantic tokens rather than inventing new
  ones — daemon-online maps to `bg-status-completed` (green) and daemon-offline
  maps to `bg-status-failed` (red), matching how `StatusBadge` consumes the
  token system. No `index.css` change is required because the `--color-status-*`
  utilities already exist; the change is confined to `AppShell.tsx`. Added a
  regression test asserting the dot carries the semantic token class for each
  of the three states.
