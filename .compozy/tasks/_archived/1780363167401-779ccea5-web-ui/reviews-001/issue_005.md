---
provider: manual
pr:
round: 1
round_created_at: 2026-06-01T11:13:34Z
status: resolved
file: web/src/lib/api/client.ts
line: 73
severity: low
author: claude-code
provider_ref:
---

# Issue 005: Run id is interpolated into request paths without encoding

## Review Comment

Several client functions splice the run id directly into the URL path:

```ts
export async function getRun(id: string)        { return apiFetch(`/runs/${id}`) }
export async function stopRun(id: string)       { return apiFetch(`/runs/${id}/stop`, ...) }
export async function retryStep(id: string)     { return apiFetch(`/runs/${id}/retry-step`, ...) }
```

The same pattern appears in `web/src/lib/ws/attach-client.ts`
(`/runs/${runId}/attach`).

Today's run ids and slug prefixes are URL-safe (hex/slug characters), so this is
not currently exploitable — hence low severity. But the id flows in from route
params (`runRoute.useParams()`), so a malformed or unexpected value would be sent
unescaped and could break path resolution or, in the worst case, alter the
targeted path. Wrap interpolated path segments in `encodeURIComponent(id)`
defensively:

```ts
return apiFetch(`/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' })
```

## Triage

- Decision: `valid`
- Notes: The issue is correct. `apiFetch` constructs a `URL` object using `new URL(path, base)`, but the path string itself is not encoded before being passed in — `new URL` does not re-encode an already-interpolated path segment. If `id` contained characters like `/`, `?`, or `#`, the path would silently break or be misrouted. The same applies to the WebSocket URL in `attach-client.ts`, which is built via a plain template literal with no encoding at all.

  Fix: wrap every path-segment interpolation of `id`/`runId` in `encodeURIComponent()` in both files.

  Scope note: `web/src/lib/ws/attach-client.ts` is outside the declared batch scope, but the issue explicitly flags it as part of the same problem. The change is a one-line, mechanical fix (add `encodeURIComponent(runId)`) with no design impact, so it is included here to fully resolve the issue.
