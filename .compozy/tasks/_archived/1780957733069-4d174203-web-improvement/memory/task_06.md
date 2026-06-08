# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Re-skin `WorkflowEditor`/`StepFields`/`EdgesField` with shadcn; move step `ide`/`mode` from `register` to `Controller` + shadcn `Select` (ADR-005). Keep RHF/zod wiring, custom-IDE round-trip, and every form testid/role.
- Baseline before edits: `WorkflowEditor.test.tsx` + `AgentModelPicker.test.tsx` = 50 tests green.

## Important Decisions

- EdgesField `next_step` stays a **native `<select>`** (only re-skinned). Task requirements + ADR-005 enumerate ONLY the start-run picker and step `ide`/`mode` as Select conversions; edge select is out of scope and its tests rely on native `selectOptions`/`.options`.
- StartRunForm (Task 5) is the reference pattern for Radix Select tests: click trigger (`getByTestId(...)`), then `getByRole('option', { name })`; assert selection via trigger `toHaveTextContent`.

## Learnings

- `AgentModelPicker` needed no re-skin: already built on shadcn `Input` + muted-foreground status text. "Visual re-skin only" was already satisfied. Left untouched to keep the `p.text-xs` status selector test stable.
- Radix `Select` trigger reflects the selected item's text via `SelectValue`; assert the bound value with `expect(trigger).toHaveTextContent('opencode')` (no `.value` like native select).
- `WorkflowEditor` re-skin used `Card`/`CardHeader`/`CardTitle`/`CardContent` for the two sections; the add-step button sits in `CardAction` (CardHeader auto-switches to `grid-cols-[1fr_auto]` when a `card-action` slot is present).

## Files / Surfaces

- `web/src/features/workflows/StepFields.tsx` — `ide`/`mode` now `Controller`+`Select`; `register` still used for id/description.
- `web/src/features/workflows/WorkflowEditor.tsx` — sections wrapped in `Card`.
- `web/src/features/workflows/EdgesField.tsx` — native `next_step` select re-skinned (Input-like classes).
- `web/src/features/workflows/WorkflowEditor.test.tsx` — 3 `ide` interactions rewritten for Radix; +5 new tests (all-controls, ide-select-updates-value, mode-toggle, filename-error, boundary-disabled).

## Errors / Corrections

## Ready for Next Run

- Final: typecheck clean; full suite 23 files / 347 tests green; coverage 94.15/83.87/96.41/95.27 (≥80% gate). Auto-commit disabled — diff left for manual review.
