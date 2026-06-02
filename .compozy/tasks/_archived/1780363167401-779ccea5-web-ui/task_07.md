---
status: completed
title: "Web: Zustand cwd store + cwd switcher UI"
type: frontend
complexity: medium
dependencies:
    - task_04
---

# Task 07: Web: Zustand cwd store + cwd switcher UI

## Overview
Make the working directory (cwd) a first-class, browser-persisted concept. A Zustand store holds the list of cwds and the active selection (persisted to `localStorage`), and a switcher component in the app shell lets the user add, remove, and fast-switch between them. The active cwd parameterizes the dashboard, workflow picker, and start-run requests.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The store MUST manage `cwds: { id, label, path }[]` and `activeCwdId`, with actions to add, remove, set-active, and read the active cwd (see TechSpec "Core Interfaces" `CwdState`).
- State MUST persist to `localStorage` (key `wfr.cwds`) and rehydrate on load.
- Adding a cwd MUST generate a stable id; removing the active cwd MUST clear or reassign the active selection sensibly.
- The switcher UI MUST allow adding (label + path), removing, and switching the active cwd, using shadcn components.
- An empty state MUST be shown when no cwds are configured.

## Subtasks
- [x] 07.1 Implement `cwdStore` with `persist` middleware and the documented actions.
- [x] 07.2 Implement add/remove/set-active logic including active-removal handling.
- [x] 07.3 Build the cwd switcher component (add form, list, switch control, remove).
- [x] 07.4 Render an empty state when no cwds exist.
- [x] 07.5 Cover store actions, persistence, and switcher interactions with tests.

## Implementation Details
Implement `web/src/stores/cwd-store.ts` and `web/src/features/cwd/` per TechSpec "Core Interfaces" (`CwdState`, the `persist` name) and "Data Models", and ADR-005. The store is the single source for the active cwd consumed by tasks 08–09. The switcher mounts in the app shell (final composition in task_11), but is self-contained and testable here.

### Relevant Files
- `web/src/stores/cwd-store.ts` — Zustand store with persistence (new).
- `web/src/features/cwd/CwdSwitcher.tsx` — switcher UI (new).
- `web/src/components/ui/*` — shadcn primitives (from task_04).

### Dependent Files
- `web/src/features/dashboard/*` (task_08) — reads active cwd for the `?cwd` filter.
- `web/src/features/start-run/*` (task_09) — reads active cwd for workflow listing + start.
- `web/src/router.tsx` / app shell (task_11) — mounts the switcher.

### Related ADRs
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — Zustand owns the persisted cwd/client state.

## Deliverables
- Persisted `cwdStore` with add/remove/set-active/activeCwd.
- Cwd switcher component with add/remove/switch + empty state.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for switcher interactions **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `addCwd("proj", "/p")` appends a cwd with a generated id; a second add yields a distinct id.
  - [x] `setActive(id)` then `activeCwd()` returns the matching cwd.
  - [x] `removeCwd(activeId)` clears or reassigns `activeCwdId` (no dangling active id).
  - [x] State written under `localStorage` key `wfr.cwds` rehydrates into the store on reload.
- Integration tests:
  - [x] Rendering the switcher with no cwds shows the empty state; adding one via the form makes it appear and become active (RTL).
  - [x] Switching the active cwd in the UI updates the store's `activeCwdId`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Cwds persist across reloads and the active cwd is readable by other features.
- The switcher supports add/remove/switch with a clear empty state.
