---
provider: manual
pr:
round: 2
round_created_at: 2026-06-05T13:46:17Z
status: resolved
file: web/src/features/workflows/useIdeCatalog.ts
line: 12
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: IDE catalog query refetches on focus, respawning IDE subprocesses

## Review Comment

`useIdeCatalog` registers a plain query with no caching options:

```ts
return useQuery({
  queryKey: ideCatalogQueryKey(activeCwd?.path ?? null, ide),
  queryFn: () => getIdeCatalog(activeCwd!.path, ide!),
  enabled: activeCwd !== null && ide !== undefined && ide !== '',
})
```

The app's `QueryClient` is constructed with no defaults (`web/src/main.tsx:8`,
`new QueryClient()`), so this query inherits `staleTime: 0` and
`refetchOnWindowFocus: true`. The catalog endpoint is the single most expensive
call in this feature by design: per the TechSpec "Primary trade-off," every
`GET /ide/{ide}/catalog` **spawns a real IDE subprocess over ACP** (and the
runtime cost / SIGTERM→SIGKILL dispose in `probeIdeCatalog`). ADR-002 frames
discovery as an on-demand probe triggered by IDE selection.

With the inherited defaults, the editor instead re-probes on every window
refocus and on every remount of `StepFields` while the data is stale (which it
always is at `staleTime: 0`). Opening the editor with steps across N distinct
IDEs and then alt-tabbing back spawns N fresh IDE subprocesses each time — churn
that contradicts the "one probe on selection" intent and burdens a local
machine. Because the probe always resolves to a `200` (`reachable:false` on
failure), this is purely wasted work, not error-recovery.

Suggested fix: scope cache options to this query so probes are deliberate:

```ts
return useQuery({
  queryKey: ideCatalogQueryKey(activeCwd?.path ?? null, ide),
  queryFn: () => getIdeCatalog(activeCwd!.path, ide!),
  enabled: activeCwd !== null && ide !== undefined && ide !== '',
  staleTime: 5 * 60_000,        // probe result stays fresh for the editing session
  refetchOnWindowFocus: false,  // never re-spawn a subprocess on tab focus
  retry: false,                 // failures already return a 200 reachable:false envelope
})
```

A "Refresh suggestions" affordance (manual `refetch()`) can cover the rare case
where the author installs/authenticates an IDE mid-session.

## Triage

- Decision: `valid`
- Root cause: `useIdeCatalog` registers `useQuery` with no caching options, and the
  app's `QueryClient` (`web/src/main.tsx:8`, `new QueryClient()`) carries no
  defaults. The query therefore inherits `staleTime: 0` and
  `refetchOnWindowFocus: true`. Because the catalog probe spawns a real IDE
  subprocess over ACP (TechSpec "Primary trade-off"; ADR-002 frames it as an
  on-demand probe on selection), the inherited defaults make the editor re-probe
  on every window refocus and on every `StepFields` remount while stale (always,
  at `staleTime: 0`). For N distinct IDEs this respawns N subprocesses per
  alt-tab — pure waste, since the probe always returns `200`
  (`reachable:false` on failure), so it is never error-recovery.
- Fix: scope cache options to this query rather than mutating the global client:
  `staleTime: 5 * 60_000` (fresh for the editing session),
  `refetchOnWindowFocus: false` (never re-spawn on focus), and `retry: false`
  (failures already arrive as a `200 reachable:false` envelope). Confined to the
  single in-scope file `web/src/features/workflows/useIdeCatalog.ts`.
- Tests: added two regression tests in `AgentModelPicker.test.tsx` using a
  defaults-free `new QueryClient()` (so the hook's own options govern behavior):
  one asserts a window refocus does not re-fetch, the other asserts a remount
  within the stale window reuses the cache. Both fail against the old hook.
