# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Task 09 (F6): hand-rolled `ThemeProvider`+`useTheme` (`'system'|'light'|'dark'`), `.dark` class on `documentElement`, `localStorage('theme')` persistence + rehydrate, system-change listener while in `system`. `ModeToggle` in shell header slot. Wrap `RouterProvider` in `main.tsx`. No new runtime dep (ADR-004). matchMedia guarded.

## Important Decisions

- `ModeToggle` built on shadcn `dropdown-menu` (canonical shadcn pattern; added via CLI — ui/** is coverage-excluded). Trigger = icon button (Sun/Moon), items System/Light/Dark.
- localStorage key: `theme`. Effective theme resolution synchronous in provider init to avoid flash (ADR-004 risk mitigation).

## Learnings

- AppShell now calls `useTheme`, so EVERY test that mounts the shell via `RouterProvider` must wrap in `ThemeProvider`: updated `__tests__/App.test.tsx`, `__tests__/routing.test.tsx`, `app/AppShell.test.tsx` render helpers. Provider order in main.tsx: `ThemeProvider > QueryClientProvider > RouterProvider`.
- React 19 — `<ThemeContext value={...}>` is a valid provider (no `.Provider`).
- Provider applies `.dark` to `document.documentElement` (a global) in jsdom; theme tests must `localStorage.clear()` + remove the `dark` class in `beforeEach`/`afterEach` to avoid cross-test bleed.
- Controllable `matchMedia` mock pattern lives in `theme-provider.test.tsx`: returns an MQL whose `addEventListener` records listeners + a `setMatches()` that flips `matches` and fires them inside `act()`. The global `test/setup.ts` matchMedia (matches:false) is enough for shell tests; only the theme tests need the controllable version.
- Radix `dropdown-menu` works under the existing pointer/ResizeObserver shims (no new shims). Drive ModeToggle: click `getByTestId('mode-toggle')`, then `getByRole('menuitem', { name: 'Light'|'Dark'|'System' })`.

## Files / Surfaces

- NEW `web/src/components/theme-provider.tsx`, `web/src/components/mode-toggle.tsx`, `web/src/components/ui/dropdown-menu.tsx` (CLI).
- EDIT `web/src/main.tsx` (wrap), `web/src/app/AppShell.tsx` (mount ModeToggle in `header-actions` slot).
- Header slot exists: `data-testid="header-actions"` in AppShell.

## Errors / Corrections

## Ready for Next Run

- Task 09 DONE + verified: typecheck clean, 25 files / 363 tests pass, coverage 94.62% stmts / 84.96% branch (global 80% gate met). No new runtime dep. Not committed (--auto-commit=false). Remaining: tasks 05, 10.
