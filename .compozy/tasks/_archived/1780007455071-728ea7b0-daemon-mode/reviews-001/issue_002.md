---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/app/commands/ps.ts
line: 32
severity: high
author: claude-code
provider_ref:
---

# Issue 002: ps --all flag parsed but never honored (PRD F4 gap)

## Review Comment

PRD F4 requires that `ps` hide terminal-state runs older than ~24h by default
and "a flag exposes the full history". `parsePsArgs` recognizes `--all`/`-a`
and surfaces it as `value.all`, but `src/app/commands/ps.ts:32` explicitly
discards the value (`void parsed.value.all;`) with a comment that the column
set is unchanged. More importantly, the daemon side
(`RunManager.list` in `src/infra/daemon/run-manager.ts:173-194`) unconditionally
filters terminal-state runs older than 24h, so even forwarding the flag would
not show full history.

This is a missing V1 functional requirement, not just a TODO.

Suggested fix:
1. Extend the RPC contract — add `params: { all?: boolean }` to `run.ps` and
   thread it through `RunManager.list({ includeOldTerminal: true })` so the
   24h cutoff is skipped when requested.
2. In `ps.ts`, forward `parsed.value.all` to `client.call("run.ps", { all })`.
3. Add an integration test covering a terminal-state run aged past the cutoff
   appearing only when `--all` is passed.

## Triage

- Decision: `VALID`
- Notes: The issue is confirmed. Three separate gaps exist:
  1. `ps.ts:32` discards `parsed.value.all` with `void` and always calls `client.call("run.ps", {})`.
  2. `protocol.ts:37` declares `"run.ps"` params as `{}` — no `all` field at all.
  3. `RunManager.list()` has no parameters; it always applies the 24h TTL cutoff for terminal-state runs.
  Fix: extend the RPC contract to add `all?: boolean`, add `options?: { includeOldTerminal?: boolean }` to `list()`, thread the flag through the handler, and forward from `ps.ts`.
