---
provider: manual
pr:
round: 2
round_created_at: "2026-06-17T22:30:00Z"
status: resolved
file: src/app/api/routes/ws-attach.ts
line: 101
severity: high
author: claude-code
provider_ref:
---

# Issue 001: WebSocket origin check rejects LAN IP connections

## Review Comment

The WebSocket pre-upgrade origin check in `registerWsAttachRoute` at
`src/app/api/routes/ws-attach.ts:101` calls `isOriginAllowed` without the
`bindHost` parameter:

```typescript
if (!isOriginAllowed(origin, port)) {
    return c.text("Forbidden", 403);
}
```

And `registerWsAttachRoute` itself never accepts `bindHost` — its signature
at line 86 is:

```typescript
export function registerWsAttachRoute(
  app: OpenAPIHono,
  rm: RunManager,
  port?: number,
  registry?: WsConnectionRegistry,
): void {
```

The call site in `src/app/api/app.ts:73` also doesn't pass `bindHost`:

```typescript
registerWsAttachRoute(app, runManager, port, wsRegistry);
```

**Impact:** The `bindHost` parameter never reaches `isOriginAllowed` in the
WebSocket upgrade path. `isOriginAllowed(origin, port)` at line 101 is called
with `bindHost` defaulting to `undefined`, which means:

- `bindHost === "0.0.0.0"` → `false` (undefined ≠ "0.0.0.0")
- `bindHost !== "127.0.0.1"` → `true` (undefined !== "127.0.0.1")

So the function falls through to the loopback-only check — only
`http://127.0.0.1:<port>` and `http://localhost:<port>` origins are accepted.
Any LAN client that connects via the LAN IP gets **403 Forbidden** on the
WebSocket upgrade, even though the HTTP Host allowlist middleware (which
correctly receives `bindHost`) already allowed their request.

This means:

- A browser at `http://192.168.1.100:4517` loads the web UI (Host middleware
  passes), but run attachment WebSocket fails with 403.
- The user sees a half-broken UI — pages render but run monitoring and input
  don't work.
- Even `--host 0.0.0.0` is affected: the Host middleware correctly accepts
  all hosts (empty allowlist), but the WebSocket origin check still enforces
  the loopback-only rule.

**Suggested fix:**

Thread `bindHost` through the same path as `port`:

1. Add `bindHost` parameter to `registerWsAttachRoute`:
   ```typescript
   export function registerWsAttachRoute(
     app: OpenAPIHono,
     rm: RunManager,
     port?: number,
     registry?: WsConnectionRegistry,
     bindHost?: string,
   ): void {
   ```

2. Pass it to `isOriginAllowed`:
   ```typescript
   if (!isOriginAllowed(origin, port, bindHost)) {
   ```

3. Update the call site in `createApiApp`:
   ```typescript
   registerWsAttachRoute(app, runManager, port, wsRegistry, bindHost);
   ```

4. Update `createServerApp` to accept and forward `bindHost` to
   `createApiApp` (it already does — verified at `app.ts:105`), and ensure
   `runDaemon()` already passes `bindHost` to `createServerApp` (verified at
   `daemon.ts:516`).

The threading already exists for `createServerApp` → `createApiApp` — only
`createApiApp` → `registerWsAttachRoute` is missing the `bindHost` forwarding.

## Affected files

- `src/app/api/routes/ws-attach.ts` — signature + `isOriginAllowed` call
- `src/app/api/app.ts` — call site in `createApiApp`

## Triage

- Decision: `valid` — confirmed bug: `registerWsAttachRoute` signature at ws-attach.ts:86 lacks `bindHost` parameter, and `isOriginAllowed(origin, port)` at line 101 is called without it, causing LAN IP origins to be rejected even when the HTTP Host middleware (which correctly receives `bindHost`) allows them. The threading from `createServerApp` → `createApiApp` already forwards `bindHost`; only the final hop to `registerWsAttachRoute` was missing.

**Fix applied:**

1. Added `bindHost?: string` parameter to `registerWsAttachRoute` in `ws-attach.ts`
2. Changed `isOriginAllowed(origin, port)` → `isOriginAllowed(origin, port, bindHost)` at line 101
3. Updated call site in `app.ts` line 73 to pass `bindHost`
4. Added two tests verifying LAN IP origin (`192.168.1.100`) and wildcard (`0.0.0.0`) acceptance via the pre-upgrade middleware

**Verification:** `bun test src/app/api/routes/ws-attach.test.ts` — 42 pass, 0 fail (the 2 new tests included). `bun run typecheck` — clean. All integration test failures are pre-existing and unrelated to this change.
