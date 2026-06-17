# TechSpec: Configurable Network Bind for External Access

## Executive Summary

Relax the daemon's hardcoded `127.0.0.1` bind address by adding a `--host` CLI
flag and `WORKFLOW_RUNNER_HOST` environment variable. The loopback assertion is
replaced with a warning logged on non-loopback binds. The security middleware's
`Host`-header and WebSocket origin allowlists are parameterized with the bind
address so they remain effective for non-loopback binds.

**Primary trade-off:** simplicity over guardrails — the feature does not add
TLS, authentication, or reverse-proxy documentation. Users are responsible for
securing any network-exposed instance.

## System Architecture

### Component Overview

No new components. Five existing files are modified:

| Component | File | Role |
|---|---|---|
| CLI parser | `src/app/cli.ts` | Parses `--host` from argv, adds to `DaemonArgs` |
| Daemon command | `src/app/commands/daemon.ts` | Forwards `WORKFLOW_RUNNER_HOST` to spawned child |
| Daemon runtime | `src/infra/daemon/daemon.ts` | Resolves bind host, passes to `Bun.serve()`, replaces assertion with warning |
| Security middleware | `src/app/api/security.ts` | Accepts bind address, adjusts allowlist logic |
| API app wiring | `src/app/api/app.ts` | Threads bind address to middleware factory |

**Data flow:**

```
CLI: --host 0.0.0.0
  → parseDaemonArgs() → DaemonArgs.bindHost
  → foreground: direct opts object
  → detach: process.env.WORKFLOW_RUNNER_HOST
    → daemon entry → runDaemon({ bindHost })
      → resolveBindHost() → Bun.serve({ hostname })
      → createServerApp({ port, bindHost })
        → hostAllowlistMiddleware(port, bindHost)
        → isOriginAllowed(origin, port, bindHost)
```

## Implementation Design

### Core Interfaces

```typescript
// src/infra/daemon/daemon.ts
export interface RunDaemonOptions {
  storageRoot?: string;
  apiPort?: number;
  /** Bind address for the HTTP server. Defaults to "127.0.0.1". */
  bindHost?: string;
}
```

```typescript
// src/infra/daemon/daemon.ts
export function resolveBindHost(
  opts: RunDaemonOptions,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (opts.bindHost !== undefined) return opts.bindHost;
  const envVal = env.WORKFLOW_RUNNER_HOST;
  if (envVal) return envVal;
  return DEFAULT_BIND_HOST; // "127.0.0.1"
}
```

```typescript
// src/app/api/security.ts
export function allowedHosts(port: number, bindHost?: string): Set<string> {
  if (bindHost === "0.0.0.0") {
    // Any Host header is valid
    return new Set<string>();
  }
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (bindHost && bindHost !== "127.0.0.1") {
    hosts.push(`${bindHost}:${port}`);
  }
  return new Set(hosts);
}
```

### Data Models

**`DaemonArgs` (CLI) — modify existing:**
```typescript
export interface DaemonArgs {
  apiPort?: number;
  storageRoot?: string;
  bindHost?: string;  // new
}
```

**`DiscoveryFileSchema` — unchanged.** The discovery file (`daemon.json`)
already contains `apiPort` and `socket`; the bind host is not needed by the
client (which connects via UDS).

### API Endpoints

No new endpoints. The existing middleware chain on `/*` and `/api/*` routes
behaves differently based on the configured bind host.

## Integration Points

None. This feature does not integrate with any external system.

## Impact Analysis

| Component | Impact | Description | Action |
|---|---|---|---|
| `src/app/cli.ts` | Modified | Add `bindHost` field to `DaemonArgs`, parse `--host` in `parseDaemonArgs`, update `USAGE.daemon` | Low risk |
| `src/app/commands/daemon.ts` | Modified | Forward `WORKFLOW_RUNNER_HOST` env var for detached spawn | Low risk |
| `src/infra/daemon/entry.ts` | None | Inherits env vars from parent process | No action |
| `src/infra/daemon/daemon.ts` | Modified | Add `bindHost` to `RunDaemonOptions`, add `resolveBindHost()`, use in `Bun.serve()`, replace `assertLoopbackBind` with `logger.log(WARN)` | Medium risk — changes startup guard |
| `src/app/api/security.ts` | Modified | Parameterize `allowedHosts()` and `isOriginAllowed()` with `bindHost` | Medium risk — changes authz surface |
| `src/app/api/app.ts` | Modified | Thread `bindHost` from daemon to middleware factories | Low risk |
| `src/app/api/schema.ts` | None | Discovery file schema unchanged | No action |
| Tests | Modified | Update existing assertion tests, add new tests for flag resolution and middleware behavior | Low risk |

## Testing Approach

### Unit Tests

- **`resolveBindHost()`** — test flag > env > default precedence, empty string, IPv6 `::`. Identical pattern to existing `resolveApiPort` tests.
- **`allowedHosts(port, bindHost)`** — test `127.0.0.1` (default), `0.0.0.0` (empty set), specific LAN IP (includes that IP + loopbacks).
- **`isOriginAllowed(origin, port, bindHost)`** — test `0.0.0.0` accepts any origin, specific LAN IP accepts that origin + loopbacks.
- **`hostAllowlistMiddleware`** — test via Hono test app with `0.0.0.0` bind (accepts any Host) and LAN IP bind (accepts that IP + loopbacks).
- **`assertLoopbackBind`** — update existing tests: no longer throws, verify it logs a warning instead.

### Integration Tests

- Add a test variant that starts the daemon harness with `WORKFLOW_RUNNER_HOST=0.0.0.0` and verifies the API responds on the loopback interface (Bun binds all interfaces; loopback still works).
- Smoke test: HTTP GET `/api/health` with `Host: 127.0.0.1:<port>` and `Host: <lan-ip>:<port>`.

## Development Sequencing

### Build Order

1. **Add `bindHost` to `RunDaemonOptions` and `resolveBindHost()`** — no
   dependencies. Pure function with tests.
2. **Wire `--host` flag through CLI and daemon command** — depends on step 1.
   Add `bindHost` to `DaemonArgs`, parse in `parseDaemonArgs`, update
   `USAGE.daemon`, forward env var in `commands/daemon.ts`.
3. **Update `Bun.serve()` and replace loopback assertion** — depends on steps
   1-2. Use resolved `bindHost` in `Bun.serve({ hostname })`. Replace
   `assertLoopbackBind` with a `logger.log(WARN)` on non-loopback.
4. **Update security middleware** — depends on step 1. Parameterize
   `allowedHosts()` and `isOriginAllowed()` with `bindHost`. Thread
   `bindHost` through `createServerApp` → `hostAllowlistMiddleware`.
5. **Update tests** — depends on steps 1-4. Update existing assertion tests,
   add new tests for flag, env var, middleware behavior.

### Technical Dependencies

None.

## Monitoring and Observability

A single structured log event is added:

```typescript
logger.log({
  level: "WARN",
  event: "api.bindNonLoopback",
  address: resolvedBindHost,
  msg: `Binding to ${resolvedBindHost} exposes the daemon to your local network`,
});
```

## Technical Considerations

### Key Decisions

- **Flag name**: `--host` (user chose over `--bind-address` and `--bind`).
- **Env var name**: `WORKFLOW_RUNNER_HOST` to match the `--flag` →
  `WORKFLOW_RUNNER_FLAG` naming pattern established by `--api-port` →
  `WORKFLOW_RUNNER_API_PORT`.
- **Warning destination**: Logger at `WARN` level (user chose over stderr).
- **Security middleware**: When `bindHost === "0.0.0.0"`, the `Host`-header
  allowlist is empty (accept all). When `bindHost` is a specific non-loopback
  IP, that IP is added alongside `127.0.0.1` and `localhost`.

### Known Risks

- **`0.0.0.0` disables the Host allowlist entirely.** Any client on the LAN
  can reach the daemon. Mitigation: the startup warning and the fact that the
  daemon binds to loopback by default.
- **Existing tests for `assertLoopbackBind` will break.** Mitigation: update
  them in the same PR (step 5 of build order).

## Architecture Decision Records

- [ADR-001: Configurable bind address for external access](adrs/adr-001.md) —
  Selected the minimal approach: configurable bind address via CLI flag and env
  var, loopback assertion replaced with warning, security middleware updated
  for non-loopback binds.
