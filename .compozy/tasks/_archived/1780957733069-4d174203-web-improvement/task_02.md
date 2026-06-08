---
status: completed
title: App shell migration to shadcn sidebar
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 2: App shell migration to shadcn sidebar

## Overview
Re-express the hand-rolled `AppShell` using the shadcn `sidebar-07` collapsible inset pattern while preserving every existing navigation route, the daemon-status indicator, and the working-directory switcher. This replaces bespoke layout markup with the shadcn shell so the whole app sits in a consistent frame.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST replace the hand-rolled shell structure in `web/src/app/AppShell.tsx` with shadcn sidebar primitives (`SidebarProvider`/`Sidebar`/`SidebarInset`, etc.).
- MUST preserve the three navigation links (Dashboard `/`, Start Run `/start`, Workflows `/workflows`) and their active-state behavior via TanStack Router `Link`.
- MUST mount `DaemonStatus` and `CwdSwitcher` inside the new shell WITHOUT refactoring their internals (ADR-001 — no internal refactor in the shell-swap PR).
- MUST preserve the `app-shell`, `app-sidebar`, and `daemon-status-dot` test identifiers and the daemon status `aria-label`.
- MUST add the shadcn `sidebar` primitive (and its peers: `separator`, `tooltip`, etc.) via the shadcn CLI.
- MUST keep the `Outlet` content region for routed feature components.
</requirements>

## Subtasks
- [x] 2.1 Add the shadcn `sidebar` primitive and required peers via the CLI.
- [x] 2.2 Rebuild `AppShell` layout with the sidebar inset pattern, keeping the three nav links and active styling.
- [x] 2.3 Mount `DaemonStatus` and `CwdSwitcher` unchanged inside the new shell.
- [x] 2.4 Carry forward `app-shell`/`app-sidebar`/`daemon-status-dot` testids and the daemon `aria-label`.
- [x] 2.5 Reserve a header slot for the future `ModeToggle` (placed in Task 9).
- [x] 2.6 Update/extend shell tests to match the new structure while keeping existing assertions green.

## Implementation Details
Modify `web/src/app/AppShell.tsx` only for structure; do not touch `CwdSwitcher.tsx`, `useHealth.ts`, or routing. See TechSpec "System Architecture" (App shell) and "Impact Analysis" row for `AppShell`. Sidebar primitive comes from the shadcn CLI per ADR-001.

### Relevant Files
- `web/src/app/AppShell.tsx` — the shell being migrated (contains `DaemonStatus`, nav `Link`s, `CwdSwitcher` mount).
- `web/src/features/cwd/CwdSwitcher.tsx` — mounted as-is; internals untouched (preserves `aria-pressed`).
- `web/src/features/health/useHealth.ts` — feeds `DaemonStatus`; unchanged.
- `web/src/router.tsx` — `rootRoute` renders `AppShell`; routes must keep working.
- `web/src/components/ui/` — `sidebar` primitive output location.

### Dependent Files
- `web/src/__tests__/App.test.tsx`, `web/src/__tests__/routing.test.tsx` — assert shell/nav rendering; selectors must keep passing.
- `web/src/features/cwd/CwdSwitcher.test.tsx` — `aria-pressed` contract must survive placement change.

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — `sidebar-07` shell swap; thin structural change only, no internal refactor.

## Deliverables
- `AppShell` rebuilt on shadcn sidebar primitives with all routes/links intact.
- `sidebar` (and peer) primitives added under `components/ui`.
- Header slot reserved for `ModeToggle`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for shell + routing navigation **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Shell renders `app-shell` and `app-sidebar` containers.
  - [x] All three nav links (Dashboard, Start Run, Workflows) render and point to `/`, `/start`, `/workflows`.
  - [x] `DaemonStatus` renders `daemon-status-dot` and the correct `aria-label` for online/offline/connecting states.
  - [x] `CwdSwitcher` renders inside the shell and retains its `aria-pressed` active selection behavior.
- Integration tests:
  - [x] Navigating between routes swaps the `Outlet` content while the sidebar persists.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The shell is visually a shadcn sidebar with zero behavioral regression to navigation, daemon status, or cwd switching.
- `bun test` and `bun run typecheck` are green.
