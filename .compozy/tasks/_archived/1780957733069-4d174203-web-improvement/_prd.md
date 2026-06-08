# PRD: Web UI Improvement — Full shadcn Adoption + Dashboard Command Center

## Overview

The `web/` control surface for workflow-runner is the secondary observation and authoring surface a solo developer uses alongside the CLI and TUI to run multi-step, multi-IDE agent workflows. Today it is inconsistent and underbuilt: shadcn/ui is configured (new-york / zinc, CSS-variable theming) but only three primitives are used (`button`, `input`, `label`); everything else — app shell, runs table, status banners, forms, run view — is hand-rolled Tailwind with ad-hoc color strings. The dashboard is a single bare table with no aggregate health view.

This effort delivers a comprehensive V1 that makes the web UI legible and trustworthy: adopt shadcn properly **across the entire app**, introduce a semantic status-token system with a single reusable `StatusBadge`, and turn the dashboard into a glanceable command center — five status summary cards (running / completed / failed / crashed / aborted) over a redesigned GitHub-Actions-style live runs list, plus a real light/dark mode selector.

It is **for the solo developer** who today drops to the terminal because the web UI feels like a degraded TUI. It is valuable because a legible, at-a-glance triage surface answers "what's running / what failed?" in under five seconds, and a uniform component foundation lowers the cost of every future UI addition — including the V2 north star, a multi-IDE step-journey "mission control" view. V1 does not claim that visual-comprehension edge yet; it builds the consistent foundation that makes it possible.

## Goals

- **Glanceable health (the 5-second rule):** a developer opening the dashboard can answer "is anything running or failing right now?" in ≤ 5 seconds, with no scrolling or clicking.
- **Whole-app visual and structural consistency:** one shadcn-based component system across the entire app — no half-migrated seam between shell and features.
- **Fast triage:** reaching a failing run takes ≤ 2 clicks (Failed card → filtered list → run detail).
- **Light/dark parity:** every status state and card is legible in both light and dark mode.
- **Zero regressions:** the existing Vitest + MSW suite stays green across every migration PR; the suite is the gate for each increment.
- **Trust:** the web UI earns daily opens as a monitoring surface, establishing the anchor for richer V2 capabilities.

Timeline: incremental, delivered as a fixed sequence of small per-feature PRs (see Phased Rollout Plan), each landing green before the next — weeks, not a big-bang rewrite.

## User Stories

Primary persona — **the solo developer** running local multi-IDE agent workflows:

- As a developer, I want to see counts of running, completed, failed, crashed, and aborted runs at a glance, so that I know the health of my workflows without parsing a table or dropping to the terminal.
- As a developer, I want a non-zero Failed count to stand out immediately, so that failures never hide in a long list.
- As a developer, I want to click a status card to filter the runs list to just those runs, so that I can jump from "something failed" to "which run" in one click.
- As a developer, I want the runs list to show status, workflow, current step, start time, and duration in an icon-first row, so that I can scan run state the way I scan GitHub Actions.
- As a developer, I want to choose light, dark, or system theme and have it remembered, so that the UI matches my environment and stays comfortable.
- As a developer, I want loading skeletons and helpful empty states, so that the UI feels finished and tells me what to do next when there's nothing to show.
- As a developer authoring workflows, I want the editor, start-run form, and run view to look and behave consistently with the rest of the app, so that the whole surface feels like one coherent tool.

Secondary flows / edge cases:

- As a developer with no runs yet, I want the dashboard to show an action-oriented empty state ("Start a run") instead of a blank panel.
- As a developer with no workflows yet, I want the workflows list to prompt me to "Create your first workflow."
- As a developer on a narrow window, I want the status cards to remain legible (wrap rather than truncate).

## Core Features

Features are grouped by the fixed build sequence. Each is an independently shippable PR that lands green before the next.

| # | Feature | Priority | Description |
|---|---------|----------|-------------|
| F1 | Status tokens + reusable `StatusBadge` | Critical | Define semantic status color pairs (running / completed / failed / crashed / aborted) as design tokens in both light and dark, and a single reusable `StatusBadge` mapping each run status to its color + icon. Built **first** to quarantine the one token-coupled, volatile piece and give every later feature a stable status primitive. |
| F2 | App shell migration | Critical | Replace the hand-rolled app shell with the shadcn collapsible inset sidebar pattern, preserving existing navigation routes, the daemon-status indicator, and the working-directory switcher (including its tested pressed-state and label behavior). |
| F3 | Redesigned runs list | High | Migrate the runs table to shadcn table primitives with GitHub-Actions-style icon-first rows: status → workflow → current step → started → duration. No IDE column in V1. All existing test identifiers and roles carried forward. Shipped before the cards so the list is stable when cards filter it. |
| F4 | Dashboard status summary cards | Critical | Five cards — Running, Completed, Failed, Crashed, Aborted — derived client-side from the existing runs poll. The Failed card is emphasized when non-zero. **Click a card to filter** the runs list to that status. |
| F5 | Remaining features migrated to shadcn (visual primitives) | High | Workflows list, workflow editor (+ step / edges / agent-model fields), start-run form, and run view (banners, transcript, controls, input box) migrated to shadcn primitives — one bounded PR per feature. Forms swap visual primitives only; the existing form-validation wiring is preserved untouched. |
| F6 | Light/dark mode selector + polish | High | A theme provider (system / light / dark) with a header toggle, persisted in the browser; all status tokens themed for both modes. Plus loading skeletons matching the final layout and action-oriented empty states. |

Interactions between features: F1's tokens and `StatusBadge` are consumed by F3 (list rows) and F4 (cards). F4's cards filter F3's list. F6's theme provider must theme F1's tokens so contrast travels with the surface.

## User Experience

**Entry → glance → triage → act.**

1. The developer opens the web UI. The shadcn sidebar shell frames the dashboard; the daemon-status indicator and working-directory switcher are where they were.
2. The dashboard shows five status cards across the top. Counts come from the existing 2s poll. If a run failed, the Failed card is visually emphasized — the answer to "is anything failing?" is immediate.
3. Below the cards, the runs list shows icon-first rows (status → workflow → current step → started → duration). Status icons/colors come from the shared `StatusBadge`.
4. The developer clicks the Failed card; the list filters to failed runs. They click a run to open its detail view.
5. First load shows skeletons matching the final layout; an empty dashboard shows "Start a run," an empty workflows list shows "Create your first workflow."
6. A theme toggle in the header switches light / dark / system; the choice is remembered on next visit. Every status state stays legible in both modes.

UI/UX considerations: honor the 5-second rule; consistent card structure (label → value → context); semantic status color (a distinct treatment per status, with a clear running state); icon-first rows; responsive card grid that wraps on narrow widths. Accessibility: preserve existing roles and labels (table role, pressed-state on the cwd switcher, form labels); ensure status is conveyed by icon + text, not color alone; maintain sufficient contrast in both themes.

Onboarding / discoverability: action-oriented empty states double as onboarding; the theme toggle lives in the header where users expect it.

## High-Level Technical Constraints

- **No new backend endpoints in V1.** Card counts and the filtered list derive entirely from the existing runs poll (~2s staleness is accepted).
- **Existing wiring preserved.** Routing, data-fetching, client store, and form-validation wiring stay intact; migrations are structural/visual swaps, not internal refactors.
- **Test contracts preserved.** Existing test identifiers, roles, and labels must carry forward; the existing automated suite is the regression gate for each increment.
- **Theme persistence is browser-local** (no server involvement).
- **Performance from the user's view:** dashboard reflects run-state changes within the existing poll interval (~2s); first paint shows skeletons rather than blank panels.

## Non-Goals (Out of Scope)

- **⌘K command palette** — high-ceiling but bets on an unproven behavior (browser over terminal); add once the web UI earns daily opens. V2 candidate.
- **Live (SSE) dashboard updates** — the existing real-time feed is per-run attach, not a global list feed; a global feed is new plumbing with a new failure-mode class. The ~2s poll is sufficient for V1.
- **Mission-control step-journey view** — the V2 north star; needs richer step/event data and the V1 component foundation in place first.
- **IDE column/badge in the runs list** — deferred to the V2 step-journey view where a multi-IDE journey can be expressed properly.
- **Full shadcn `Form`/`Controller` adoption in forms** — V1 swaps visual primitives only; the idiomatic form-component rewrite is out of scope.
- **Daemon-side theme/preference storage** — browser-local only in V1.

## Phased Rollout Plan

Delivered as a fixed PR sequence; each PR lands green (suite passing) before the next. The phase grouping below maps the sequence to validation milestones.

### MVP (Phase 1) — Foundation + dashboard command center

- F1 status tokens + `StatusBadge` (PR 1)
- F2 app shell (PR 2)
- F3 redesigned runs list (PR 3)
- F4 status summary cards with click-to-filter (PR 4)
- **Success criteria to proceed:** the 5-second rule is met on the dashboard; triage to a failing run is ≤ 2 clicks; suite green through PR 4.

### Phase 2 — Whole-app consistency

- F5 remaining features migrated to shadcn visual primitives, one bounded PR each: workflows list, workflow editor (+ fields), start-run form, run view (PRs 5+)
- **Success criteria to proceed:** ≥ 90% of all UI components use shadcn primitives; suite green through every feature PR; no half-migrated seam remains.

### Phase 3 — Theme + polish

- F6 light/dark selector, loading skeletons, action-oriented empty states (final PR)
- **Long-term success criteria:** 100% of status states legible in both themes; skeletons and empty states present on every primary view; the web UI is opened as a monitoring surface in daily use.

## Success Metrics

| Metric | Target | How measured |
|--------|--------|--------------|
| Time-to-status (5-second rule) | ≤ 5s, no scroll/click | Can "is anything failing/running?" be answered at a glance on dashboard open |
| shadcn adoption (whole app) | ≥ 90% of UI components | Audit every component under `web/src` for shadcn vs hand-rolled markup |
| Triage clicks to failing run | ≤ 2 | Count clicks: Failed card → filtered list → run detail |
| Light/dark parity | 100% of status states legible in both modes | Visual check of every `StatusBadge` state + cards in light and dark |
| Test regressions | 0 | Existing suite stays green across every migration PR |
| Web UI daily opens | Trends up | Qualitative: the developer chooses the web UI for monitoring instead of the terminal |

## Risks and Mitigations

- **Rewrite trap / never finishing** (the central concern). *Mitigation:* strict per-feature PR sequencing in a fixed order, each landing green; no big-bang branch.
- **Silent test breakage** across the suite (run-row identifiers, table role, pressed-state, form labels). *Mitigation:* build `StatusBadge` first; carry all identifiers/roles/labels forward; deliberate selector audit per PR; the suite is the gate.
- **Card busyness on narrow viewports** — five cards crowd small windows. *Mitigation:* responsive grid that wraps; count + label stay legible at all widths.
- **Adoption risk** — the developer may keep preferring the terminal. *Mitigation:* lead with the observation value (glanceable triage) that earns daily opens before investing in command features (the V2 palette).
- **Staleness vs. the TUI** — the ~2s poll lags the real-time TUI. *Mitigation:* accepted, logged debt for V1; live updates scoped for V2.
- **Scope/timeline** — full-app migration is weeks, not days. *Mitigation:* phased rollout with clear per-phase success criteria; value lands progressively (dashboard usable after Phase 1).

## Architecture Decision Records

- [ADR-001: Adopt shadcn across the whole app in V1 (sequenced, per-feature); defer command palette and live updates to V2](adrs/adr-001.md) — Records the full-app migration decision, the fixed build sequence (StatusBadge first), and the V2 deferrals (⌘K, SSE).
- [ADR-002: V1 dashboard and form-migration scope refinements](adrs/adr-002.md) — Five separate status cards, visual-primitives-only form migration, no IDE column in V1, browser-local theme persistence.

## Open Questions

_All four idea-stage open questions were resolved during clarification (see ADR-002). No blocking ambiguities remain._

- Card responsive layout below which width cards wrap vs. condense — a presentation detail to settle during the cards PR; not a blocker.
- Whether "completed" and "aborted" cards stay visible when their count is zero, or hide to reduce clutter — defaults to always-visible for layout stability; revisit if the row feels noisy.
