# PRD: Configurable Network Bind for External Access

## Overview

The workflow-runner daemon currently binds exclusively to `127.0.0.1`,
restricting the web UI and API to the local machine. Users who want to access
the dashboard from other devices on their LAN, or expose it behind their own
reverse proxy for internet access, have no way to do so without modifying
source code.

This feature makes the bind address configurable via a CLI flag and environment
variable, enabling LAN and internet use cases while keeping the loopback-only
default for existing users.

## Goals

- Allow users to bind the daemon HTTP server to any network interface via a
  `--host` flag or `WORKFLOW_RUNNER_HOST` environment variable.
- Remove the hard loopback assertion that aborts startup on non-loopback binds.
- Preserve loopback-only behavior by default — zero configuration change for
  existing users.
- Emit a warning when binding to a non-loopback address to signal the security
  implications.

## User Stories

- As a developer, I want to access the workflow-runner web UI from my tablet
  or phone on the same LAN so I can monitor runs without sitting at my desktop.
- As a team lead, I want to share a running workflow-runner instance with
  colleagues on the office network so we can collaborate on workflow debugging.
- As an operations user, I want to place the daemon behind an nginx reverse
  proxy on a VPS so I can access it from anywhere via my own domain.

## Core Features

### Configurable bind address

- Add a `--host` flag to the `daemon` subcommand accepting a valid IP address
  or hostname (default: `127.0.0.1`).
- Add `WORKFLOW_RUNNER_HOST` environment variable with the same
  precedence as existing `WORKFLOW_RUNNER_API_PORT`: CLI flag overrides env
  var, env var overrides default.
- The daemon passes the resolved hostname to `Bun.serve()`.

### Loopback assertion removal

- Remove `assertLoopbackBind` or bypass it when a non-default host is
  provided.
- Replace the hard abort with a startup warning when binding to any address
  other than `127.0.0.1` or `localhost`.

### Security middleware update

- Update `hostAllowlistMiddleware` and `isOriginAllowed` to accept any
  `Host` header value when the daemon is bound to `0.0.0.0`.
- When bound to a specific non-loopback IP, accept that IP and `localhost` as
  valid hosts.

## User Experience

- A user who runs `workflow-runner daemon start --host 0.0.0.0` sees a
  warning: "Warning: binding to 0.0.0.0 exposes the daemon to your local
  network. Use a reverse proxy with TLS and authentication for internet
  access."
- On the same LAN, another device can open `http://<lan-ip>:4517` in a
  browser and see the web UI.
- Existing users who run `workflow-runner daemon start` with no flags see no
  change in behavior.
- The existing `--api-port` flag continues to work alongside `--host` (e.g.,
  `--host 0.0.0.0 --api-port 8080`).

## High-Level Technical Constraints

- Must be consistent with existing configuration patterns (CLI flag + env var
  - default, same precedence rules as `--api-port` / `WORKFLOW_RUNNER_API_PORT`).
- Must not break the CLI ↔ daemon UDS transport (client already uses the
  socket file, not the TCP port).
- Must not introduce any new dependencies.

## Non-Goals (Out of Scope)

- Built-in TLS/SSL termination — users bring their own reverse proxy.
- Built-in authentication or API keys — users bring their own auth layer.
- Auto-detection or printing of LAN IP addresses.
- CORS auto-configuration — the existing `WORKFLOW_RUNNER_UI_ORIGIN` env var
  remains available for cross-origin setups.
- Configuration file support — only CLI flags and environment variables.
- Reverse proxy setup documentation.

## Phased Rollout Plan

### MVP (Phase 1)

- `--host` flag + `WORKFLOW_RUNNER_HOST` env var implemented.
- Loopback assertion removed, warning added for non-loopback binds.
- Security middleware updated to accept non-loopback `Host` values.
- Tests pass.

## Success Metrics

- Users can access the web UI from a LAN device after setting `--host 0.0.0.0`.
- All existing tests continue to pass.
- No regressions in loopback-only default behavior.

## Risks and Mitigations

- **Users may bind to `0.0.0.0` and expose the daemon to the public
  internet without a reverse proxy.** The startup warning is the primary
  mitigation. Users explicitly chose not to include documentation.
- **Existing workflows relying on the loopback assertion may break.** The
  assertion is a development guard, not a documented contract; the warning
  preserves the signal without the hard failure.

## Architecture Decision Records

- [ADR-001: Configurable bind address for external access](adrs/adr-001.md) —
  Selected the minimal approach: configurable bind address via CLI flag and env
  var, loopback assertion replaced with warning, security middleware updated
  for non-loopback binds.

## Open Questions

- Should the warning be printed to stderr or logged via the existing logging
  infrastructure? (Minor — can be decided during implementation.)
- Should the `Host`-header allowlist for non-loopback binds accept any host
  value, or only the exact bind IP and `localhost`? (Clarified during
  brainstorming: accept any host when bound to `0.0.0.0`, accept specific IP
  - `localhost` for other non-loopback binds.)
