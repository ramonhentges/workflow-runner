# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

DONE. Re-skinned the run-view feature (`RunView`, `RunControls`, `Transcript`, `InputBox`, `StepProgress`) to shadcn. Behavior/selectors/roles preserved; `useAttach`/reducer/protocol untouched. Full suite green (352 tests), typecheck clean, run-view coverage 95% stmts / 100% lines.

## Important Decisions

- Banners → shadcn `Alert`. The generated `alert.tsx` hardcodes `role="alert"` then spreads `{...props}` AFTER, so the closed banner overrides with `role="status"` simply by passing `role="status"`. Error banner keeps the default `role="alert"`. Both keep `socket-error-notice`/`socket-closed-notice` testids on the Alert root (which also exposes `data-slot="alert"`).
- Summary panel → shadcn `Card` (Header/Title/Content), keeping `summary-panel` testid (now also `data-slot="card"`). Terminal+non-null-summary gate unchanged.
- `StatusBadge` added to `RunControls` toolbar, rendered only when `status !== null` (vm.status is `RunStatus | null`; StatusBadge needs non-null). This satisfies 8.5 "render status where shown" — the run view previously displayed no status text anywhere.
- `StepProgress` re-skinned to `Badge` (active=`default`, inactive=`secondary`) + `ChevronRight` separator; kept `step-indicator-${id}` + `data-active`.
- `Transcript` swapped raw `text-blue-600`/`text-yellow-600`/`border-blue-200` (not dark-mode safe) for theme tokens (`text-primary`, `text-status-running`, `border-border`). Kept testids/data-kind.
- `InputBox` already used shadcn Input/Button; only container styling touched, enable rule + send untouched.

## Learnings

- `alert` primitive added via `yes N | bunx shadcn@latest add alert` from `web/`. Coverage excludes `ui/**`, so the new generated file doesn't affect the 80% gate.
- Run-view tests live in ONE file `RunView.test.tsx` (48→51 tests: added Alert role/`data-slot` assertions to the two socket integration tests + 3 unit tests for StatusBadge presence/absence and summary Card `data-slot`).

## Files / Surfaces

- `web/src/features/run-view/{RunView,RunControls,Transcript,InputBox,StepProgress}.tsx` — re-skinned.
- `web/src/features/run-view/RunView.test.tsx` — assertions extended (all prior selectors/roles preserved).
- `web/src/components/ui/alert.tsx` — new primitive (generated).

## Errors / Corrections

None.

## Ready for Next Run

- Tasks 05, 09, 10 still pending. `alert` primitive now available for any remaining banner/notice work.
