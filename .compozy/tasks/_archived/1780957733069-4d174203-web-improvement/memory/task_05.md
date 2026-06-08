# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Re-skin `StartRunForm.tsx` with shadcn primitives; swap native workflow `<select>` for Radix-backed shadcn `Select` (ADR-005). Preserve local-state validation/submit/navigate flow, `workflow-select` id on the trigger, manual-path mutual-exclusion, and all state testids.
- Baseline (pre-change): `StartRunForm.test.tsx` = 18 tests passing on native `<select>`.

## Important Decisions

- Controlled Radix `Select` must stay controlled: pass `value={selectedPath}` (empty string `""` for "nothing selected"), NOT `value={selectedPath || undefined}`. Passing `undefined` flips it to uncontrolled and it keeps its last value, so the placeholder won't return when the manual-path input clears the selection. Empty string is fine on the root (only `SelectItem` forbids empty values).
- Trigger is the labeled control: `<Label htmlFor="workflow-select">` + `<SelectTrigger id="workflow-select">`. The `workflow-select` identifier moved from the native `<select>` to the trigger button per ADR-005.

## Learnings

- Drive Radix `Select` in tests: `findByRole('combobox')` → click → `findByRole('option', { name })` → click. The trigger is `role="combobox"` (only one in this form), options are `role="option"` with the visible text. `selectOptions` only works on native `<select>` and was removed.
- jsdom shims for Radix Select added to `web/test/setup.ts`: `hasPointerCapture`, `setPointerCapture`, `releasePointerCapture`, `scrollIntoView` (ResizeObserver already present from Task 02). Shared with Task 06.
- Assert trigger content with `toHaveTextContent('wf1.json')` (selected) / `'— select a workflow —'` (placeholder) to verify mutual exclusion.

## Files / Surfaces

- `web/src/components/ui/select.tsx` — added via `bunx shadcn@latest add select` (pattern: `yes N | bunx ...` to keep existing files).
- `web/test/setup.ts` — pointer/scroll shims added.
- `web/src/features/start-run/StartRunForm.tsx` — re-skinned (wrapped in `Card`, native `<select>` → shadcn `Select`).
- `web/src/features/start-run/StartRunForm.test.tsx` — selectOptions interactions rewritten; +2 mutual-exclusion tests (20 total).

## Errors / Corrections

## Ready for Next Run
