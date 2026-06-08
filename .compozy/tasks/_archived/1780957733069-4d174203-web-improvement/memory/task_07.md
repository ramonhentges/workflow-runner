# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Re-skin `WorkflowList` to shadcn `Table`/`Card` while preserving navigation, bare-name addressing, and every testid/role. DONE + verified.

## Important Decisions

- KEPT the inline two-step delete confirm (Delete → Confirm/Cancel buttons in-row) instead of migrating to `AlertDialog`. The MUST requirement "preserve all existing test identifiers, roles, and any delete-confirmation behavior" + "every prior test selector still resolves" wins over the conditional `Dialog/Alert` mention ("if present"). Tests use `within(row).getByRole('button', { name: 'Confirm' })`; a Radix portal-rendered AlertDialog renders to document.body, outside the row, which would break those queries. Confirm/Cancel already use shadcn `Button`.
- Wrapped the `Table` in a `Card` (`className="overflow-hidden p-0"`) to satisfy "re-skin to Table/Card" and give a bordered container. (Note: sibling `RunsTable` does NOT wrap in Card — minor inconsistency, acceptable since task_07 explicitly calls for Card.)
- Error banners (`delete-error`/`start-error`, `role="alert"`) left as styled divs — did not add the `alert` primitive (out of consumed-primitives scope; behavior/role preserved).

## Learnings

- No new shadcn primitives needed: `table`, `card`, `button` all already present under `components/ui/`.
- shadcn `Table` renders a real `<table>` with `data-slot="table"`; `getByRole('table')` still resolves. Empty/error/no-cwd states render no table, so `queryByRole('table')` absence assertions still hold.

## Files / Surfaces

- `web/src/features/workflows/WorkflowList.tsx` — re-skinned (raw `<table>` → shadcn `Table`/`Card`).
- `web/src/features/workflows/WorkflowList.test.tsx` — added missing `error state` test (required deliverable) + re-skin assertions (`data-slot="table"`/`data-slot="card"`). 349 tests total now.

## Errors / Corrections

- RECONCILIATION (not task_07 scope): `WorkflowEditor.test.tsx` (task_06 uncommitted) had a pre-existing `tsc` error at line 476 — `putBody` typed `{name?}|null` narrowed to `null` by CFA (assigned only inside an MSW closure). `vitest` doesn't run tsc, so the baseline test run hid it. Fixed by aligning to the working sibling idiom at line 538: `let putBody: unknown = null` + drop the cast on assignment. Required to keep the shared `bun run typecheck` gate (ADR-001) green.

## Ready for Next Run

- task_07 complete, verified green. No auto-commit (this run had --auto-commit=false). Diff left for manual review.
