---
status: completed
title: Theme provider + ModeToggle
type: frontend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 9: Theme provider + ModeToggle

## Overview
Add a hand-rolled theme provider supporting system/light/dark with browser-local persistence, and a `ModeToggle` control in the shell header. The `.dark` class strategy and token blocks already exist in `index.css`, so this task supplies only the control: resolve system preference, toggle the class, and persist the choice (ADR-004, ADR-002).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST provide a `ThemeProvider` + `useTheme` exposing `{ theme, setTheme }` where `theme` is `'system' | 'light' | 'dark'` (see TechSpec "Core Interfaces").
- MUST resolve the effective theme from system preference (`matchMedia`) when set to `system`, and react to system changes while in `system` mode.
- MUST toggle the `.dark` class on `document.documentElement` to switch themes (reusing the existing `index.css` `.dark` tokens).
- MUST persist the user's choice to `localStorage` and rehydrate it on load (browser-local only, no daemon involvement — ADR-002).
- MUST mount the provider around `RouterProvider` in `web/src/main.tsx`.
- MUST place a `ModeToggle` control in the shell header slot reserved in Task 2.
- MUST guard for the absence of `matchMedia` so tests/SSR-less environments do not crash.
</requirements>

## Subtasks
- [x] 9.1 Build `ThemeProvider` + `useTheme` (system resolution, class toggle, localStorage persistence, system-change listener).
- [x] 9.2 Mount the provider around `RouterProvider` in `main.tsx`.
- [x] 9.3 Build `ModeToggle` and place it in the shell header.
- [x] 9.4 Apply the persisted theme synchronously on init to minimize a flash of the wrong theme.
- [x] 9.5 Test system resolution, explicit selection, persistence, and rehydration with a mocked `matchMedia`/`localStorage`.

## Implementation Details
Create `web/src/components/theme-provider.tsx` and a `ModeToggle` (its own file or alongside the shell). Edit `web/src/main.tsx` to wrap `RouterProvider`. Place `ModeToggle` in the header slot from Task 2. Reuse the existing `.dark` blocks in `index.css`. See TechSpec "Core Interfaces" (`useTheme`) and ADR-004.

### Relevant Files
- `web/src/main.tsx` — app entry; provider mounts around `RouterProvider`.
- `web/src/index.css` — existing `:root`/`.dark` tokens and `@custom-variant dark` the toggle drives.
- `web/src/app/AppShell.tsx` — header slot for `ModeToggle` (from Task 2).
- `web/src/components/ui/` — `dropdown-menu`/`button` primitives a `ModeToggle` typically uses.

### Dependent Files
- `web/src/__tests__/App.test.tsx` — app now renders inside `ThemeProvider`; setup may need a `matchMedia` mock.
- Shared Vitest setup — `matchMedia` mock for theme tests.

### Related ADRs
- [ADR-004: Hand-rolled theme provider over a next-themes dependency](../adrs/adr-004.md) — ~40-line context; `.dark` + localStorage; no new dependency.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — Browser-local persistence, system default.

## Deliverables
- `web/src/components/theme-provider.tsx` exporting `ThemeProvider`/`useTheme`.
- `ModeToggle` mounted in the shell header.
- `main.tsx` wrapping the app in `ThemeProvider`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for toggling theme across the app shell **(REQUIRED)**

## Tests
- Unit tests:
  - [x] With `theme='system'` and `matchMedia` reporting dark, the `.dark` class is applied; reporting light removes it.
  - [x] Selecting `dark` explicitly applies `.dark` and persists `theme=dark` to `localStorage`.
  - [x] Selecting `light` removes `.dark` and persists `theme=light`.
  - [x] On mount with a persisted `theme` in `localStorage`, that choice is rehydrated and applied.
  - [x] A change in system preference while in `system` mode updates the applied class.
- Integration tests:
  - [x] `ModeToggle` in the shell switches the document theme class end-to-end and the selection survives a remount.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Theme can be set to system/light/dark from the header, persists across reloads, and drives the existing `.dark` tokens.
- No new runtime dependency is introduced.
