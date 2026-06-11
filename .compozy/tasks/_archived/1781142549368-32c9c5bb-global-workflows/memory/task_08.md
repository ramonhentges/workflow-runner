# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

DONE + verified (uncommitted). Start-run picker now surfaces workflow scope and can
run a global workflow against the active cwd. No run-layer change.

## Important Decisions

- Picker option = `wf.name` (kept `.json`, current display) + a scope `Badge`
  (Global=`secondary`/Project=`outline`, `data-testid="workflow-scope-badge"`,
  `data-scope`), wrapped in a `<span className="flex items-center gap-2">`. Mirrors
  WorkflowList's badge variants/scopeLabel.
- `useWorkflows.ts` left UNCHANGED: it already consumes the combined scoped list
  (`listWorkflows` returns scope-tagged items via task_03/04). The cwd gate stays —
  the whole form is gated on `activeCwd`, so global items only appear/run with an
  active cwd, satisfying the PRD gate.
- Submit path unchanged: `selectedPath` (= `wf.path`) + `activeCwd.path`. Global
  items flow through identically (verified by test asserting the global abs path +
  active cwd payload).

## Learnings

- Rendering a Badge inside a Radix `SelectItem` changes the option's accessible
  name to include the badge text (e.g. "wf1.json Project"). Exact `getByRole('option',
  { name: 'wf1.json' })` matchers break — switch to regex `/wf1\.json/`. This also
  affected an unrelated test: `web/src/__tests__/routing.test.tsx` (full operate
  loop) used an exact option matcher and its mock lacked `scope`; both fixed.
- The selected value renders the badge in the trigger too (Radix `SelectValue`
  echoes item children) — harmless; `toHaveTextContent('wf1.json')` still passes.

## Files / Surfaces

- `web/src/features/start-run/StartRunForm.tsx` — badge import, `scopeLabel`,
  `WorkflowScope` type import, badge in `SelectItem`.
- `web/src/features/start-run/StartRunForm.test.tsx` — scope on all mock items,
  regex option matchers, new `scoped picker` describe (lists both scopes w/ badges;
  global selection → start payload).
- `web/src/__tests__/routing.test.tsx` — mock scope + regex option matcher (collateral).
- `useWorkflows.ts` NOT modified (already correct).

## Errors / Corrections

- Initial full-suite run failed only on `routing.test.tsx:288` (exact option name).
  Root cause = badge changing accessible name; fixed via regex + scope in mock.

## Ready for Next Run

- Web gate green: typecheck 0, 435/435 tests, 94.01% stmt cov.
