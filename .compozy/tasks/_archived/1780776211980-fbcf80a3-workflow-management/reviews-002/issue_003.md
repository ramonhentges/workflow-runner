---
provider: manual
pr:
round: 2
round_created_at: 2026-06-05T13:46:17Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 124
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Workflows list has no per-row Run action

## Review Comment

The Workflows list renders three per-row actions — Edit, Duplicate, and
Delete (`WorkflowList.tsx:124-178`) — but no way to **start a run** for the
workflow on that row. The list is the natural launching point for a workflow,
yet to run one the user must leave the list, navigate to the separate `/start`
route, and re-select the same workflow from a dropdown
(`StartRunForm.tsx:71-92`). Every piece needed for a one-click action already
exists; only the affordance in the list is missing.

This is purely additive — no existing behavior is wrong:

- The start capability is already implemented end-to-end:
  `startRun()` posts to `POST /runs` (`web/src/lib/api/client.ts:121`), and
  `StartRunForm` navigates to `/runs/$runId` on success
  (`StartRunForm.tsx:23-29`).
- The list already knows the workflow's `path` (`workflow.path`, used as the
  row key at `WorkflowList.tsx:115`) — the exact value `startRun` expects as
  `workflowPath`.
- The "Duplicate" action shows the pattern for a row-scoped link that carries
  the workflow identity into another screen via search params
  (`WorkflowList.tsx:133-140`, `to="/workflows/new" search={{ from: bareName }}`).

Suggested fix — add a Run action to the row, mirroring the existing links:

```tsx
import { Play } from 'lucide-react'
// ...
<Link
  to="/start"
  search={{ workflow: workflow.path }}
  className={actionLinkClass}
>
  <Play className="size-4" aria-hidden="true" />
  Run
</Link>
```

To make the link meaningful, `StartRunForm` should read the `workflow` search
param and pre-select it (seed `selectedPath` from it), so the run can be started
in one click without re-picking from the dropdown. Alternatively, a direct
"start + navigate" mutation on the row avoids the intermediate form entirely;
the form route remains useful for the manual-path case. Either way the run-aware
delete/rename guard is unaffected, since this only adds a start path that already
flows through `POST /runs`.

## Triage

- Decision: `valid`
- Root cause: The Workflows list (`WorkflowList.tsx`) exposes Edit/Duplicate/
  Delete per row but no affordance to start a run, even though `startRun()`
  (`POST /runs`) and the row's `workflow.path` are already available. Running a
  listed workflow forces the user out to the separate `/start` route to re-pick
  the same workflow. Purely additive UX gap, not a correctness defect — hence
  `low`.
- Fix approach: Implemented the issue's alternative "start + navigate" option,
  which keeps the change confined to the single in-scope file
  (`web/src/features/workflows/WorkflowList.tsx`). Added a per-row primary "Run"
  button that fires a `startRun({ workflowPath: workflow.path, cwd })` mutation
  (mirroring the existing `deleteMutation` pattern), invalidates the `runs`
  query, and navigates to `/runs/$runId` on success. A row-scoped error banner
  surfaces start failures, and the button shows a "Starting…" pending state. The
  link-to-`/start` variant was deliberately not chosen because it would require
  touching `router.tsx` (add a `workflow` `validateSearch`) and `StartRunForm.tsx`
  (seed `selectedPath`), both outside this batch's code scope; the
  start+navigate mutation delivers the same one-click run without expanding scope.
  The run-aware delete/rename guard is unaffected since this only adds a start
  path through the existing `POST /runs` flow.
- Tests: Added `WorkflowList run flow` cases covering the success path (POST sent
  with the row's path + active cwd, navigation to the run view) and the error
  path (failure banner shown, row preserved). Extended the test router wrapper
  with a `/runs/$runId` stub.
