# PRD: Workflow Runner Web UI

## Overview

The workflow-runner daemon already exposes a full HTTP/WebSocket API for operating runs, but the only client today is the terminal (CLI + TUI). This product adds a **browser-based Operator Console** so a developer can manage and observe workflow runs from a graphical interface on their own machine.

- **Problem it solves:** Operating runs today means memorizing CLI subcommands, juggling run IDs, and watching a single TUI at a time. There is no at-a-glance view of all runs, no easy way to switch between projects, and interactive "chat" with a run lives in a terminal.
- **Who it is for:** The solo developer running workflows locally. The daemon API is loopback-only (`127.0.0.1`), so the UI is a single-user, single-machine tool — not a shared/hosted dashboard.
- **Why it is valuable:** A persistent dashboard plus a rich live run view turns run operation into point-and-click: see every run's status, start a run from a chosen working directory, drive interactive steps via chat, and stop/retry without touching the CLI.

## Goals

- Provide a single screen where the user sees all active and recent runs with live status, replacing `workflow-runner ps`.
- Let the user start a run by choosing a working directory and a workflow, replacing `workflow-runner start`.
- Let the user attach to a run and converse with interactive steps in real time, replacing `workflow-runner attach` + `send`.
- Let the user stop or retry a run inline, replacing `workflow-runner stop` + `retry-step`.
- Make working-directory switching a first-class, persistent concept so the user can move between projects quickly.
- Deliver the complete operate loop in the MVP, on top of the existing API, with minimal new backend surface.

## User Stories

**Primary persona — the local operator (developer running workflows).**

- As an operator, I want to see all my runs and their current status in one place so I don't have to query the CLI.
- As an operator, I want to register and switch between multiple working directories so I can operate workflows across several projects without retyping paths.
- As an operator, I want to start a run by picking a workflow from my current directory's `./workflows` folder (or pasting a path) so launching is fast and low-error.
- As an operator, I want to open a run and watch its output stream live so I can follow what the agent is doing.
- As an operator, I want to type messages to an interactive step and see responses inline so I can drive the workflow conversationally.
- As an operator, I want to see which step is running and which are done so I understand where the run is.
- As an operator, I want stop and retry buttons inside the run view so I can intervene without leaving the page.
- As an operator, I want a clear summary when a run finishes so I know the outcome at a glance.

## Core Features

Grouped by priority for the MVP.

**P0 — Working-directory management**
- Register, name, and remove working directories (cwds); pick an "active" cwd; fast-switch between them.
- The cwd list and active selection persist in the browser across sessions (client-side state).
- All start-run actions are scoped to the active cwd.

**P0 — Run dashboard**
- A persistent list of active and recent runs showing slug/id, workflow, status (`running | completed | failed | crashed | aborted`), current step, started/ended time, and attached-client count.
- Auto-updates as run statuses change. A toggle reveals all terminal-state runs.
- Each row links into the run's live view.

**P0 — Start a run**
- From the active cwd, choose a workflow file from its `./workflows` folder, or enter a workflow path manually; confirm to start.
- On start, navigate directly into the new run's live view.

**P0 — Live run view (chat + observability)**
- Streaming message view rendered from run events (step banners, logs, agent output chunks, status), with newest activity visible as it arrives.
- An input box for interactive steps; enabled only when the current step accepts input, disabled otherwise.
- **Step-progress indicator:** which step is running, which have completed, and position in the workflow.
- **Inline run controls:** Stop and Retry-step buttons whose availability reflects the run's current status (e.g., retry only on crashed/failed/aborted).
- **Final summary panel:** when a run finishes, surface the run summary (outcome and what each step produced) prominently.

**P0 — Run control actions**
- Stop a run (graceful then forceful) and retry the failing step, with the dashboard and live view reflecting the resulting status.

**Feature interaction:** the active cwd gates the Start-run flow; starting a run creates a dashboard entry and routes into its live view; control actions taken in the live view are reflected back in the dashboard.

## User Experience

**Persona & goal:** the local operator wants to launch and babysit workflow runs with less friction than the CLI.

**Primary flow — start and operate a run:**
1. First launch: the user adds a working directory (path) and it becomes the active cwd; it's remembered for next time.
2. The user clicks "Start run," picks a workflow from the cwd's `./workflows` list (or pastes a path), and confirms.
3. The app opens the live run view; the user watches output stream in, sees the step-progress indicator advance, and types into the input box when an interactive step is active.
4. If something goes wrong, the user clicks Stop or Retry step inline.
5. When the run finishes, the final summary panel shows the outcome; the run remains in the dashboard as a recent run.

**Secondary flow — monitor existing runs:** the user lands on the dashboard, scans statuses across all runs, and drills into any run to inspect its live or historical activity.

**UX considerations:**
- App shell with a persistent cwd switcher and access to the dashboard.
- "Dashboard + one focused run": the user works with one run view at a time; navigating away ends that view's live stream (no simultaneous multi-attach in the MVP).
- Clear visual status states (running/completed/failed/crashed/aborted) and disabled-state affordances for controls and the input box.
- Empty states: no cwds yet, no runs yet, no workflows found in `./workflows`.
- Error surfacing for failed actions (e.g., unknown run, run no longer interactive) without losing the view.

## High-Level Technical Constraints

These are fixed boundaries provided as inputs; implementation detail belongs in the TechSpec.

- The web UI is a **new standalone project at the repository root** with its own `package.json`, not nested inside `src/`.
- The repository and the web UI are **managed together with Turborepo** (a monorepo with sibling workspace packages).
- The web UI is built with **React, TanStack Router, shadcn, and Zustand** (Zustand owns client state, including the persisted cwd list).
- The UI consumes the **existing daemon HTTP/WS API over loopback** (`127.0.0.1`); it discovers the live port via the daemon's published discovery file rather than hardcoding it.
- The product is **single-user and local-only**, consistent with the API's loopback + Host/Origin allowlist security model. No authentication, multi-tenant, or remote-access requirements.
- **Dependency:** listing a cwd's `./workflows` folder requires a backend capability the daemon does not expose today. Manual-path entry is the fallback that works without it.

## Non-Goals (Out of Scope)

- Workflow authoring or editing (creating/modifying/validating workflow JSON in the UI).
- Full workflow graph/DAG visualization (the MVP shows a step list/breadcrumb only).
- Simultaneous multi-run attach (tabbed live sessions for several runs at once).
- Automatic reconnect/resume of a live stream after a tab disconnect (deferred; resume semantics exist in the API but are not wired into the MVP).
- Run-history analytics, comparisons, or dashboards beyond the active/recent list.
- Desktop/browser notifications on run completion.
- Remote/hosted access, multi-user collaboration, authentication, or RBAC.
- Mobile-optimized layouts.

## Phased Rollout Plan

### MVP (Phase 1)
- Monorepo restructuring (Turborepo) with the web UI as a root-level package.
- Working-directory management (add/remove/switch, persisted client-side).
- Run dashboard with live-updating status and an "all runs" toggle.
- Start a run (workflow from `./workflows` or manual path) scoped to the active cwd.
- Live run view: streaming chat, interactive input, step-progress indicator, inline stop/retry, final summary panel.
- **Success criteria to proceed:** the user can complete the full loop — add a cwd, start a run, chat through an interactive step, stop/retry, and read the final summary — entirely in the browser, without the CLI.

### Phase 2
- Automatic reconnect/resume of live streams after disconnect.
- Workflow graph/DAG visualization in the run view.
- Browser notifications on run completion/failure.
- **Success criteria to proceed:** resume works reliably across tab refreshes and the graph view is used in place of the step list.

### Phase 3
- Tabbed/simultaneous multi-run attach.
- Run-history views and lightweight analytics.
- **Long-term success:** the console becomes the default way to operate the runner, with the CLI reserved for scripting.

## Success Metrics

- **Task completion:** a user can go from "no cwd configured" to "run finished with summary read" without touching the CLI.
- **Operate-loop coverage:** 100% of the CLI operate verbs (`ps`, `start`, `attach`, `send`, `stop`, `retry-step`) have a UI equivalent in the MVP.
- **Live latency (user perception):** streamed output and status changes appear in the UI promptly enough to feel "live" (no manual refresh needed).
- **Start friction:** starting a run from a previously-used cwd takes only a directory selection plus a workflow pick.
- **Reliability:** control actions (stop/retry) reflect the correct resulting status in both the live view and dashboard every time.

## Risks and Mitigations

- **Backend dependency for workflow listing.** Listing `./workflows` for a cwd needs a capability the daemon lacks. *Mitigation:* ship manual-path entry first; scope the listing capability as a tracked dependency.
- **Adoption vs. the TUI.** Existing users are comfortable in the terminal. *Mitigation:* match the TUI's interactive/chat behavior closely so the UI is a strict superset for operation.
- **Scope creep toward authoring/visualization.** The graph and editor are tempting. *Mitigation:* explicit non-goals and a phased plan keep them out of the MVP.
- **Monorepo migration friction.** Restructuring the established single-package repo could disrupt existing Bun-based workflows. *Mitigation:* preserve the runner's current commands within the new pipeline; validate before merge.
- **Single-machine constraint surprises.** Users may expect remote access. *Mitigation:* document the loopback-only, single-user posture clearly.

## Architecture Decision Records

- [ADR-001: Web UI product shape — Operator Console](adrs/adr-001.md) — Build a single-user local control plane (cwd switcher + run dashboard + focused live run view); exclude authoring and graph visualization from the MVP.
- [ADR-002: Restructure repository into a Turborepo monorepo with a separate web app](adrs/adr-002.md) — Convert the repo into a Turborepo-managed monorepo with the runner and the new React/TanStack/shadcn/Zustand web UI as sibling packages.

## Open Questions

- What backend capability will expose a cwd's `./workflows` listing, and is it in scope for this effort or a prerequisite? (Manual-path entry unblocks the MVP regardless.)
- How should the chat view render the different event kinds (banner/log/stream/status/summary) visually — as a unified transcript or distinct lanes? (UX detail for TechSpec/design.)
- Should the cwd "path" be validated against the daemon (does it exist on the machine) before it can be made active, or accepted as free text?
- When navigating away from a focused run mid-stream, is silently ending the stream acceptable, or should the user be warned?
