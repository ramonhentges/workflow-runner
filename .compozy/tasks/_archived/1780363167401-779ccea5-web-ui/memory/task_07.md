# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `cwdStore` (Zustand + persist) and `CwdSwitcher` component. Store is the single source of active cwd for tasks 08–09.

## Important Decisions

- `addCwd` auto-activates the first cwd (activeCwdId === null guard). Task spec integration test requires "adding one via the form makes it appear and become active."
- `removeCwd(activeId)` reassigns to `cwds[0].id` (first remaining) or `null` if empty.
- `activeCwd()` implemented as a store method using `get()` closure — returns `null` on dangling activeCwdId.
- shadcn components (Button, Input, Label) created manually in `web/src/components/ui/` without Radix UI — no `@radix-ui/*` packages are installed. Components use `cn()` + Tailwind classes only.
- CwdSwitcher list item: label-only text on switch button (path shown as separate `<span>`) so RTL can use `getByRole('button', { name: 'label' })` without path noise.
- Persistence test uses: reset store → overwrite localStorage → call `(useCwdStore as any).persist.rehydrate()`. The setState() call writes empty state to localStorage first; localStorage.setItem() after that overwrites it; then rehydrate() picks up the test data.

## Learnings

- Zustand v5 persist stores `{ state: { cwds, activeCwdId }, version: 0 }` in localStorage; functions are excluded by JSON.stringify.
- `setState({ cwds: [], activeCwdId: null })` (no replace=true) merges, keeping store functions intact. Using replace=true would wipe functions.
- `(useCwdStore as any).persist.rehydrate()` is async and returns Promise<void>. Works in Vitest with `await`.
- After `setState(empty)`, the persist subscriber fires synchronously and writes empty state to localStorage. The localStorage.setItem() call must come AFTER setState() to win the ordering race.
- `crypto.randomUUID()` is available in jsdom v29 (no mock needed).

## Files / Surfaces

- `web/src/stores/cwd-store.ts` (new) — Zustand store with persist
- `web/src/stores/cwd-store.test.ts` (new) — 17 unit tests
- `web/src/components/ui/button.tsx` (new) — shadcn-style Button
- `web/src/components/ui/input.tsx` (new) — shadcn-style Input
- `web/src/components/ui/label.tsx` (new) — shadcn-style Label
- `web/src/features/cwd/CwdSwitcher.tsx` (new) — switcher component
- `web/src/features/cwd/CwdSwitcher.test.tsx` (new) — 9 RTL integration tests

## Errors / Corrections

None.

## Ready for Next Run

- task_08 and task_09 can import `useCwdStore` from `@/stores/cwd-store` — `activeCwd()` returns the active `Cwd | null`.
- task_11 mounts `<CwdSwitcher />` in the app shell.
- shadcn Button/Input/Label are available for other tasks at `@/components/ui/{button,input,label}`.
