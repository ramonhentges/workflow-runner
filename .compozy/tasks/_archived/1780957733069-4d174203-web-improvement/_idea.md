# Web UI Improvement — shadcn Adoption + Dashboard Command Center

## Overview

The `web/` control surface for workflow-runner has shadcn/ui configured but barely used (only `button`, `input`, `label`); everything else is hand-rolled Tailwind, and the dashboard is a single bare table. This idea delivers a comprehensive V1: adopt shadcn properly **across the entire app**, introduce a semantic status-token system, and turn the dashboard into a glanceable command center — status summary cards (running / success / failed / crashed / aborted) over a redesigned live runs list, plus a real light/dark mode selector.

It is **for the solo developer** who runs multi-step, multi-IDE agent workflows locally and uses the web UI as a secondary observation/authoring surface alongside the CLI and TUI. It is valuable because the web UI today feels like a degraded TUI; a legible, at-a-glance triage surface answers "what's running / what failed?" in under five seconds. Per the decision owner, **V1 adopts shadcn across the entire app** — not just the shell and dashboard — executed as a sequence of small, per-feature PRs (tests as the gate) rather than a big-bang rewrite, establishing a uniform component foundation that the V2 north star (a multi-IDE step-journey "mission control" view) builds on.

## Problem

The web UI is inconsistent and underbuilt. The app shell, runs table, status banners, and forms are bespoke Tailwind with ad-hoc color strings (`statusClass()` returning `'text-blue-600'`), so status isn't scannable and the experience feels unfinished — which erodes the trust needed for the developer to actually open it. shadcn is installed and configured, but the investment is stranded at three primitives.

The dashboard specifically fails the "5-second rule." To answer "is anything failing right now?" the developer must scan a full table row by row, or drop to the terminal and parse `workflow-runner ps`. There is no aggregate view, no semantic color system, no at-a-glance health. For a tool whose whole job is orchestrating long-running agent workflows, the absence of glanceable run health is the core gap.

The web UI also lacks a distinct identity versus the CLI/TUI. Without a legible monitoring surface that earns daily opens, richer future capabilities (command palette, live updates, step-journey visualization) have no anchor to build on.

### Market Data

- shadcn's **`dashboard-01` + `sidebar-07`** blocks are near-turnkey scaffolds for exactly this shell + stat-cards + data-table composition.
- **GitHub Actions** is the reference pattern for run lists: icon-first status → workflow → step/progress → duration, with faceted filters.
- Dashboard UX consensus: the **5-second rule**, consistent KPI card structure (Label → Value → context), and semantic status color (green/red/amber + a running state) are the load-bearing patterns.
- `cmdk` (wrapped by shadcn `Command`) is the de-facto ⌘K standard in dev tools (Linear, Vercel, Raycast) — noted as a high-ceiling V2 candidate, not V1.

## Core Features

| #  | Feature | Priority | Description |
|----|---------|----------|-------------|
| F1 | shadcn foundation + status tokens + `<StatusBadge>` | Critical | Extract semantic status color pairs into `:root`/`.dark`, add a single reusable `StatusBadge` mapping each run status to color + icon. Done **first** to quarantine the volatile token-coupled piece. Add missing primitives (Card, Table, Badge, Skeleton) as needed. |
| F2 | App shell via `sidebar-07` | Critical | Replace hand-rolled `AppShell` with the shadcn collapsible inset sidebar, preserving existing routes, `DaemonStatus`, and `CwdSwitcher` (and its tested `aria-pressed`/label contracts). |
| F3 | Dashboard status summary cards | Critical | Four+ cards (running / success / failed / crashed / aborted) derived client-side from the existing `listRuns` poll; non-zero **Failed** rendered prominently; **click-a-card-to-filter** the runs list. |
| F4 | Redesigned runs list (shadcn `Table`) | High | Migrate RunsTable to shadcn `Table`, GitHub-Actions-style icon-first rows (status → workflow → current step → started → duration), carrying all `data-testid`s/roles forward. Shipped as its own PR before F3's cards PR. |
| F5 | Light/dark mode selector + implementation | High | A theme provider (system/light/dark) + `ModeToggle` in the header, persisting choice; all status tokens themed for both modes so contrast travels with the surface. |
| F6 | Loading skeletons + empty states | Medium | Skeleton cards/rows on first load (matching final layout); action-oriented empty states ("Start a run" / "Create your first workflow") instead of blank panels. |
| F7 | Migrate remaining features to shadcn | High | Workflows list, workflow editor (+ step/edges/agent-model fields), start-run form, and run view (banners, transcript, controls, input box) migrated to shadcn primitives — `Form`/`Select`/`Dialog`/`Card`/`Alert` — one bounded PR per feature, preserving `data-testid`s, roles, and react-hook-form/zod wiring. |

## KPIs

| KPI | Target | How to Measure |
|-----|--------|----------------|
| Time-to-status (5-sec rule) | ≤ 5s, no scroll/click | Manual: can "is anything failing/running?" be answered at a glance on dashboard open |
| shadcn adoption (whole app) | ≥ 90% of all UI components use shadcn primitives | Audit every component under `web/src` (shell + all features) for shadcn vs hand-rolled markup |
| Triage clicks to failing run | ≤ 2 | Count clicks: Failed card → filtered list → run detail |
| Light/dark parity | 100% of status states legible in both modes | Visual check of every `StatusBadge` state + cards in light and dark |
| Test regressions | 0 | `bun test` in `web/` stays green across every migration PR |

## Feature Assessment

| Criteria | Question | Score |
|----------|----------|-------|
| **Impact** | How much more valuable does this make the product? | Must do |
| **Reach** | What % of users would this affect? | Strong |
| **Frequency** | How often would users encounter this value? | Must do |
| **Differentiation** | Does this set us apart or just match competitors? | Maybe |
| **Defensibility** | Is this easy to copy or does it compound over time? | Maybe |
| **Feasibility** | Can we actually build this? | Must do |

Leverage type: **Quick Win that compounds** (the component layer + tokens lower the cost of every future UI addition, including the V2 north star).

## Council Insights

- **Recommended approach:** Adopt shadcn across the whole app via a fixed, sequenced series of per-feature PRs: status tokens + `<StatusBadge>` → app shell (`sidebar-07`) → RunsTable → shadcn `Table` (selector audit) → summary cards w/ click-to-filter → remaining features one PR each (workflows list, workflow editor, start-run form, run view) → light/dark selector + skeletons/empty states. Each PR lands green before the next.
- **Key trade-offs:** The council recommended bounding V1 to shell + dashboard; the decision owner chose **full-app migration** for complete consistency (no half-migrated seam). The rewrite-trap risk this introduces is mitigated by **strict per-feature PR sequencing** (fixed order, each landing green) rather than by cutting scope. The 2s poll is still kept (≤2s staleness) rather than building live updates now.
- **Risks identified:** (1) Rewrite-trap / never finishing — *mitigation:* fixed PR order, each green, no big-bang branch. (2) Silent test breakage across the 19-file suite (`run-row-${id}`, `getByRole('table')`, `aria-pressed`, `getByLabelText`) — *mitigation:* extract `StatusBadge` first, carry `data-testid`s/roles forward, selector audit per PR. (3) `sidebar-07` and shadcn `Form`/`Select` fighting existing router/query/store/react-hook-form wiring — *mitigation:* thin structural swaps; don't refactor component internals in the same PR as the shadcn swap.
- **Stretch goal (V2+):** **"Mission control"** — a visual multi-IDE step-journey view (claude-code → opencode → codex → gemini) showing per-step status, the edge/intent taken, and inline failure context. This is the web UI's structural advantage over the terminal and the north star the V1 foundation enables. Live SSE updates and the ⌘K command palette are secondary V2 candidates.

## Out of Scope (V1)

- **⌘K command palette** — high-ceiling but bets on an unproven behavior (browser over terminal); add once the web UI earns daily opens. V2 candidate.
- **Live SSE dashboard updates** — the existing WebSocket feed is per-run `attach`, not a global list feed; a global feed is new plumbing across daemon/client/web with a new failure-mode class. 2s poll is good enough for V1.
- **Mission-control step-journey view** — the V2 north star; needs richer run-event/step data surfaced and the V1 component foundation in place first.

## Architecture Decision Records

- [ADR-001: Adopt shadcn across the whole app in V1 (sequenced, per-feature); defer command palette and live updates to V2](adrs/adr-001.md) — Records the full-app migration decision (decision-owner override of the council's bounded recommendation), the fixed build sequence (StatusBadge first), and the V2 deferrals.

## Open Questions

- Should the summary cards split `completed` vs `crashed` vs `aborted` into separate cards, or group "success" vs "not-success" with a breakdown on hover? (Five statuses, limited card real estate.)
- Theme persistence mechanism — `localStorage` only, or also respect/persist via a daemon-side preference? (Local-only assumed for V1.)
- Does the redesigned runs list need an explicit IDE column/badge in V1, or is that better held for the V2 mission-control view?
- For the form-heavy features (workflow editor, start-run), migrate to shadcn `Form` (react-hook-form `<Controller>` wrappers) wholesale, or only swap visual primitives while leaving the existing RHF wiring intact?

## Summary / Differentiator

The web UI's defensible edge is **visual comprehension of multi-IDE agent workflows** — something a terminal cannot render. V1 doesn't claim that edge yet; it builds the legible, trustworthy, fully consistent foundation (whole-app shadcn, tokens, glanceable dashboard) that makes the V2 mission-control view possible.

## Integration with Existing Features

| Integration Point | How |
|---|---|
| `useRuns` / `listRuns` poll | Summary card counts + filtered list derive from the existing 2s-poll data; no new endpoint. |
| `AppShell` (`DaemonStatus`, `CwdSwitcher`) | Preserved inside the new `sidebar-07` shell with contracts/tests intact. |
| Existing CSS-var theme (`index.css`) | Status tokens added to existing `:root`/`.dark`; theme selector toggles the `.dark` class. |
| Workflow management UI (editor, list, start-run) | Migrated to shadcn `Form`/`Select`/`Dialog` while preserving react-hook-form + zod validation and existing route behavior. |
| Vitest + MSW suite | Migrations preserve `data-testid`/roles; suite is the regression gate (KPI: 0 regressions). |
