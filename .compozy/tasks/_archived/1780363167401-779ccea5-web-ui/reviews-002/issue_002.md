---
provider: manual
pr:
round: 2
round_created_at: 2026-06-01T13:24:34Z
status: resolved
file: web/src/app/AppShell.tsx
line: 4
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Daemon health/reachability indicator from the TechSpec is unimplemented

## Review Comment

The TechSpec specifies a daemon-reachability indicator in two places:

- Integration Points: "the app surfaces daemon reachability via `GET /health`
  (a header status indicator) and shows clear error states for failed HTTP
  calls and WS disconnects."
- Monitoring and Observability: "The app surfaces daemon reachability via
  `GET /health` (a header status indicator)."

The HTTP wrapper exists — `getHealth()` in `web/src/lib/api/client.ts:81-83`
and the `HealthReport` type in `web/src/lib/api/types.ts:72` — but nothing
consumes it. A repo-wide search finds no `useHealth` hook, no query, and no
component reference; `getHealth` is dead code. `AppShell` (the persistent shell
that would host such an indicator) renders only the title, nav, and cwd
switcher (`AppShell.tsx:4-40`) with no health/status element.

Effect: when the daemon is down or unreachable, the user gets no global
"daemon offline" signal. Failures only surface lazily and per-feature (the
dashboard's "Failed to load runs.", a run view's "Connection closed."), with no
at-a-glance liveness indicator as the spec intends. The dead `getHealth` export
also signals the wiring was started but never finished.

Note: no task in `_tasks.md` explicitly carried the health indicator (it is
mentioned only in the API-client task), so this is a spec-vs-implementation gap
rather than a regressed feature. Suggested fix: add a small `useHealth` query
(polled, with `enabled` always-on) and render a status dot/label in the
`AppShell` header reflecting reachable/unreachable, or — if the indicator is
intentionally deferred — remove the unused `getHealth`/`HealthReport` surface
and record the deferral so the spec and code agree.

## Triage

- Decision: `valid`
- Notes: The `getHealth()` function in `web/src/lib/api/client.ts` and the `HealthReport` type in `web/src/lib/api/types.ts` exist but are dead code — nothing calls them. The TechSpec explicitly requires "the app surfaces daemon reachability via `GET /health` (a header status indicator)" in both the Integration Points and Monitoring/Observability sections. `AppShell` is the correct place for this global indicator but currently only renders the title, nav, and cwd switcher. Root cause: the API-client task was completed, but the AppShell wiring was never added. Fix: create a `useHealth` TanStack Query hook (polled, always-on) and render a status dot + label in the `AppShell` header. Files outside `<batch_scope>`: `web/src/features/health/useHealth.ts` and `web/src/features/health/useHealth.test.tsx` are new files required to implement the hook — the minimum necessary to deliver the feature correctly.
