---
provider: manual
pr:
round: 1
round_created_at: 2026-06-01T11:13:34Z
status: resolved
file: web/src/features/dashboard/useRuns.ts
line: 8
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: useRuns polls all runs every 2s when no cwd is active

## Review Comment

`useRuns` issues the `GET /runs` query unconditionally with a 2-second
`refetchInterval`, even when there is no active cwd:

```ts
const activeCwd = useCwdStore(state => state.activeCwd())
return useQuery({
  queryKey: ['runs', { cwd: activeCwd?.path ?? null, all: opts.all ?? false }],
  queryFn: () => listRuns({ cwd: activeCwd?.path, all: opts.all }),
  refetchInterval: 2000,
})
```

When `activeCwd` is `null`, `listRuns({ cwd: undefined })` omits the `cwd` query
param, so the daemon returns **all runs across every working directory** — the
opposite of the PRD's "all start/list actions are scoped to the active cwd."
`RunsTable` happens to short-circuit to the no-cwd empty state so the data is
never displayed, but the request still fires every 2 seconds in the background.

This is inconsistent with the sibling hook `useWorkflows`, which correctly gates
itself with `enabled: activeCwd !== null`. Apply the same guard here:

```ts
return useQuery({
  queryKey: ['runs', { cwd: activeCwd?.path ?? null, all: opts.all ?? false }],
  queryFn: () => listRuns({ cwd: activeCwd!.path, all: opts.all }),
  enabled: activeCwd !== null,
  refetchInterval: 2000,
})
```

This stops the wasteful recurring fetch and keeps run listing strictly
cwd-scoped.

## Triage

- Decision: `valid`
- Notes: The issue is confirmed. `useRuns` fires a `GET /runs` request every 2 seconds regardless of whether an active cwd is set. When `activeCwd` is `null`, the `cwd` query param is omitted, so the daemon returns runs from all working directories — violating the PRD's cwd-scoping requirement. The data is silently discarded by `RunsTable`, but the polling still burns bandwidth and CPU. The sibling `useWorkflows` hook already applies `enabled: activeCwd !== null` as the correct guard. Fix: add `enabled: activeCwd !== null` to the query options and tighten the `queryFn` to use `activeCwd!.path` (safe because TanStack Query skips the fn when `enabled` is false).
