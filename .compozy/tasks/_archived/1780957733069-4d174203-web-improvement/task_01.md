---
status: completed
title: Status design tokens + reusable StatusBadge
type: frontend
complexity: medium
dependencies: []
---

# Task 1: Status design tokens + reusable StatusBadge

## Overview
Establish the semantic status color system and a single reusable `StatusBadge` component that maps every `RunStatus` to a color token, icon, and label. This is the foundational, token-coupled piece built first (ADR-001) so every later feature consumes one stable status primitive instead of the scattered `statusClass()` color strings.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add five semantic status color token pairs (running, completed, failed, crashed, aborted) to both `:root` and `.dark` in `web/src/index.css`, registered through `@theme inline` so Tailwind utilities resolve them.
- MUST provide a single `StatusBadge` component as the only place a `RunStatus` is mapped to color + icon + label.
- MUST support both an icon-only rendering (for dense table cells) and an icon+label rendering (for cards/banners).
- MUST ensure every status state is legible in both light and dark mode (PRD light/dark parity KPI).
- MUST add the shadcn `badge` primitive via the shadcn CLI (and any of `card`/`skeleton`/`table` needed to validate the badge in context).
- MUST NOT introduce a new package or directory when a single component file suffices.
</requirements>

## Subtasks
- [x] 1.1 Define the five status token pairs in light and dark and wire them through `@theme inline`.
- [x] 1.2 Add the shadcn `badge` primitive via the CLI.
- [x] 1.3 Build `StatusBadge` mapping each `RunStatus` to token + lucide icon + label, with icon-only and labeled modes.
- [x] 1.4 Verify contrast of all five states in both themes.
- [x] 1.5 Unit-test all five statuses in both rendering modes.

## Implementation Details
Add tokens to `web/src/index.css` (existing `:root`/`.dark` blocks and the `@theme inline` mapping). Create `web/src/components/status-badge.tsx`. Replace the ad-hoc `statusClass()` switch currently in `RunsTable.tsx` conceptually (the actual call-site swap happens in Task 3). See TechSpec "Core Interfaces" for the `StatusBadgeProps`/`StatusMeta` shape and "System Architecture" for its role.

### Relevant Files
- `web/src/index.css` — holds the existing token blocks and `@theme inline`; status tokens are added here.
- `web/src/lib/api/types.ts` — defines `RunStatus`, the exhaustive union the badge maps over.
- `web/src/features/dashboard/RunsTable.tsx` — current `statusClass()` color strings that `StatusBadge` supersedes (reference only; swapped in Task 3).
- `web/src/components/ui/` — shadcn primitive output directory; `badge` lands here.
- `web/src/lib/utils.ts` — `cn()` helper used by the component.

### Dependent Files
- `web/src/features/dashboard/RunsTable.tsx` — will consume `StatusBadge` (Task 3).
- `web/src/features/dashboard/StatusSummaryCards.tsx` — will consume `StatusBadge` (Task 4).
- `web/src/features/run-view/*` — may consume `StatusBadge` for run status (Task 8).

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — Mandates StatusBadge + tokens are built first to quarantine the volatile token coupling.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — Five distinct statuses drive five token pairs.

## Deliverables
- Five status token pairs in `:root` and `.dark`, mapped via `@theme inline`.
- `web/src/components/status-badge.tsx` exporting `StatusBadge`.
- `badge` shadcn primitive added under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for StatusBadge rendering within a representative consumer **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `StatusBadge status="running"` renders the running label, running icon, and running tone class.
  - [x] Each of `completed`/`failed`/`crashed`/`aborted` renders its correct label, icon, and tone.
  - [x] `showLabel={false}` renders the icon only and no text label.
  - [x] `showLabel` (labeled mode) renders both the icon and the visible status text.
  - [x] A passed `className` is merged onto the rendered element.
- Integration tests:
  - [x] All five `StatusBadge` states render without error inside a list/card container (smoke render across the union).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `StatusBadge` is the single source of status presentation (no remaining ad-hoc status color logic introduced elsewhere by this task).
- All five status states are legible in both light and dark mode.
