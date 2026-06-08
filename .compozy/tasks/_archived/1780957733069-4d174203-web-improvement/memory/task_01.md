# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Status design tokens + reusable `StatusBadge` (F1, ADR-001). Done — verified.

## Important Decisions

- `StatusBadge` renders the shadcn `Badge` with `variant="outline"` + tone classes; `border-transparent` overrides the outline border so the 10% tint reads cleanly. `data-status` set for selector targeting.
- Icon-only mode (`showLabel={false}`) drops all text (no sr-only node) and uses `aria-label` for AT, so `queryByText(label)` is null as the tests require.
- Removed the CLI-generated `skeleton.tsx` and `table.tsx` (unused dead code that dragged coverage). Only `badge` (required) + `card` (used in the integration test) kept. Task 02/03 regenerate table/skeleton via CLI when consumed.
- Light `crashed` token tuned to L=0.553 to clear WCAG AA (was 4.27, now 5.14).

## Learnings

- lucide-react renders `<svg class="lucide lucide-<kebab-name> …">`; tests query the icon by `.lucide-loader-circle` etc. Icon→class: running=loader-circle, completed=circle-check, failed=circle-x, crashed=triangle-alert, aborted=ban.
- shadcn CLI (`bunx shadcn@latest add …`) works here and installs the unified `radix-ui` package (badge imports `Slot` from `radix-ui`, not `@radix-ui/react-slot`).
- Coverage `include: src/**/*.{ts,tsx}` counts every file, so unused generated primitives lower global coverage — add primitives only when consumed.

## Files / Surfaces

- `web/src/index.css` — 5 `--status-*` pairs in `:root`/`.dark` + `--color-status-*` in `@theme inline`.
- `web/src/components/status-badge.tsx` (new) — `StatusBadge` + `STATUS_META`.
- `web/src/components/status-badge.test.tsx` (new) — 10 tests (unit + integration).
- `web/src/components/ui/badge.tsx`, `card.tsx` (new, via CLI).

## Errors / Corrections

- Initial light `crashed` (L=0.595) failed AA at 4.27; corrected to 0.553.

## Ready for Next Run

- `StatusBadge` is the single status-presentation source. Task 03 swaps `RunsTable.statusClass()` to consume it (icon-only in cells). Task 04 uses labeled mode in cards.
- Contrast verified AA in both themes for all 5 statuses (script: oklch→sRGB→WCAG).
