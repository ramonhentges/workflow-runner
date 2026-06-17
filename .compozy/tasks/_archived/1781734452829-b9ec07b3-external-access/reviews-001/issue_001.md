---
provider: manual
pr:
round: 1
round_created_at: "2026-06-17T21:44:46Z"
status: resolved
file: src/app/api/security.ts
line: 6
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: IPv6 addresses not handled in security middleware

## Review Comment

`allowedHosts()` and `isOriginAllowed()` do not account for IPv6 address
formats, creating two related gaps:

1. **`::` (IPv6 all-interfaces) is not treated like `0.0.0.0`.** When a user
   binds to `::` with `--host ::`, the intent is the same as `0.0.0.0` — listen
   on all interfaces. But `allowedHosts` adds `":::port"` to the allowlist
   (which never matches any Host header) instead of returning an empty set to
   accept all hosts. This effectively disables legitimate cross-origin requests
   over IPv6 while still making the daemon reachable on the network.

2. **IPv6 addresses lack bracket notation in Host/Origin checks.** HTTP
   Host headers for IPv6 use bracket notation (`[::1]:port`, not `::1:port`).
   `allowedHosts` builds bare entries like `"::1:port"` which will never match
   an actual Host header. `isOriginAllowed` has the same problem — it compares
   against raw `"http://::1:port"` instead of `"http://[::1]:port"`.

**Suggested fix:**

In `allowedHosts`, treat `::` identically to `0.0.0.0`:

```typescript
export function allowedHosts(port: number, bindHost?: string): Set<string> {
  if (bindHost === "0.0.0.0" || bindHost === "::") {
    return new Set<string>();
  }
```

In `isOriginAllowed`, add the same `::` check before the per-IP branch.

For the bracket-notation issue, wrap IPv6 addresses in brackets when
constructing host entries. A helper like this would work:

```typescript
function formatHost(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}
```

Then use it in `allowedHosts` and `isOriginAllowed` whenever constructing a
`${bindHost}:${port}` string.

## Triage

- Decision: `VALID`
- Root cause: `allowedHosts` and `isOriginAllowed` were written for IPv4 only. No consideration was given to IPv6 address formats.
  - Gap 1: `bindHost === "0.0.0.0"` is checked but `bindHost === "::"` is not — the all-interfaces semantics of `::` are identical to `0.0.0.0`.
  - Gap 2: Raw `${bindHost}:${port}` string interpolation is used, which produces invalid Host/Origin values for IPv6 addresses (e.g., `::1:4517` instead of `[::1]:4517`).
- Fix approach:
  1. Add `formatHost(host, port)` helper that wraps IPv6 addresses in brackets.
  2. Use `formatHost` in both `allowedHosts` and `isOriginAllowed` whenever constructing a host string.
  3. Add `|| bindHost === "::"` alongside every `bindHost === "0.0.0.0"` check.
  4. Add tests for `::` (all-interfaces), `::1` (loopback IPv6), and `[::1]:port` bracket-notation in Host/Origin checks.
