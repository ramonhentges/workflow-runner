---
provider: manual
pr:
round: 1
round_created_at: 2026-06-01T11:13:34Z
status: resolved
file: web/src/features/start-run/StartRunForm.tsx
line: 20
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: Workflow-listing errors are silently swallowed in start-run

## Review Comment

`StartRunForm` reads only `data` from the workflows query and discards the
error/loading state:

```ts
const { data: workflowsData } = useWorkflows()
const workflows = workflowsData?.workflows ?? []
```

The picker `<select>` is then rendered only when `workflows.length > 0`. As a
result the UI cannot distinguish three very different situations, all of which
collapse to "just show the manual path input":

1. The cwd genuinely has no `./workflows` folder (empty list — expected).
2. `GET /workflows` is still loading.
3. `GET /workflows` failed (daemon down, invalid cwd → see issue 001, etc.).

The PRD calls out "no workflows found in `./workflows`" as a distinct empty
state, and the UX section asks for "error surfacing for failed actions." Right
now a failed listing looks identical to an empty folder, which is misleading.

Suggested fix: surface the query state, e.g.

```ts
const { data, isLoading, isError } = useWorkflows()
// show a "couldn't list workflows — enter a path manually" notice on isError,
// and optionally a loading hint while isLoading.
```

Manual-path entry remains the correct fallback; the issue is only that the
failure is invisible to the user.

## Triage

- Decision: `valid`
- Notes: The issue is correct. `StartRunForm` only destructures `data` from `useWorkflows()`, discarding `isLoading` and `isError`. All three states — loading, network error, and genuinely empty — collapse to the same UI (manual path input only). The fix surfaces `isLoading` and `isError` from the query, adds a "Loading workflows…" notice while fetching, and adds a "Could not load workflows — enter a path manually." error notice when the query fails. The workflow picker condition (`workflows.length > 0`) stays the same, so stale-data cases are handled correctly. Tests are added for both the loading and error states.
