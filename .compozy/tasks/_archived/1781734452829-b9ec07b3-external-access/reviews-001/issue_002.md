---
provider: manual
pr:
round: 1
round_created_at: "2026-06-17T21:44:46Z"
status: resolved
file: src/infra/daemon/daemon.ts
line: 95
severity: low
author: claude-code
provider_ref:
---

# Issue 002: warnNonLoopbackBind flags localhost as non-loopback

## Review Comment

`warnNonLoopbackBind` checks `boundHostname !== "127.0.0.1"` to decide whether
to emit a security warning. This misses two loopback-equivalent values:

- `"localhost"` — resolves to `127.0.0.1` / `::1`, commonly used with
  `--host localhost`.
- `"::1"` — IPv6 loopback, equally safe.

When a user runs `--host localhost`, they get a spurious WARN-level log:
"Binding to localhost exposes the daemon to your local network". This is
misleading since `localhost` is loopback-only and not reachable from the
network.

**Suggested fix:**

Extend the check to recognize all loopback forms:

```typescript
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function warnNonLoopbackBind(
  boundHostname: string,
  logger: { log: (rec: DaemonLogRecord) => void },
): void {
  if (!LOOPBACK_HOSTS.has(boundHostname)) {
    logger.log({
      level: "WARN",
      event: "api.bindNonLoopback",
      address: boundHostname,
      msg: `Binding to ${boundHostname} exposes the daemon to your local network`,
    });
  }
}
```

## Triage

- Decision: `VALID`
- Root cause: `warnNonLoopbackBind` used a single inequality check (`boundHostname !== "127.0.0.1"`), which treated `localhost` and `::1` (both loopback-equivalent) as non-loopback, producing a spurious security warning.
- Fix: Replaced the inequality with a `Set(["127.0.0.1", "localhost", "::1"])` lookup.
- Tests: Added test cases for `localhost` and `::1` confirming no warning is emitted. All 35 tests pass (0 fail), typecheck clean.
