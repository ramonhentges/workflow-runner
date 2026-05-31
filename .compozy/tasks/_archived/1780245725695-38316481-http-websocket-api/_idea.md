# Idea: HTTP + WebSocket API for the workflow-runner daemon

## Overview

workflow-runner orchestrates agentic workflows (opencode via ACP) as a local Bun/TypeScript daemon. Today the daemon speaks only JSON-RPC over a Unix domain socket, consumed by an in-tree CLI and a TUI. Any non-TUI consumer — a web dashboard, an automation script, a second device watching a long-running run — is locked out of the surface.

This idea adds an HTTP + WebSocket API mounted inside the daemon process, exposing enough surface that a future web UI can match TUI capabilities (list / start / stop / attach / send / live event stream / chat-style input). The V1 ships **API only** — no UI is being built yet. Localhost-only, no auth, single maintainer.

V1 ambition is deliberately bounded by a council-driven scope: the thinnest credible HTTP slice plus one WebSocket endpoint for attach+send, wrapped behind a transport-agnostic application-service seam so that JSON-RPC (existing), HTTP/WS (this idea), and any future transport (SSE, gRPC, gateway process) become peer adapters over the same domain operations. A V2 stretch direction — workflow replay and time-travel via the existing `EventLog` — is explicitly captured but excluded from V1.

## Summary / Differentiator

Most local agent runners (claude-code, opencode, codex) are CLI/TTY-only. Hosted competitors (Temporal, Inngest, Trigger.dev, Dagster) ship full control planes but at a different scale and operational complexity. workflow-runner's differentiator is the *combination*: a single-binary local daemon with a documented HTTP+WS contract over the same event-sourced state model used by the in-tree TUI. The hybrid V1+V2 path positions the project to add the killer feature — workflow replay / fork-from-seq, which competitors charge for — as a *byproduct* of the V1 API seam, because `EventLog` already records the data.

## Problem

The TUI is the only viewer of the daemon's run state. If the user closes the terminal, opens a second device, or wants a casual "is it done yet?" glance from a browser tab, there is no path. The current architecture forces every consumer to be an in-process JSON-RPC client over a Unix socket — fine for a CLI binary, hostile to anything else.

A second, sharper problem: debugging long-running agent workflows today requires re-running them from scratch. The daemon already persists every event to a per-run JSONL log with monotonic sequence numbers and a 1000-entry ring buffer (`infra/daemon/event-log.ts`). That infrastructure compounds into time-travel debugging the moment it is exposed — but only after some API surface exists to mount the endpoints onto. The HTTP+WS API is the *prerequisite* for that compounding feature, not just a convenience for a future UI.

A third, structural problem: the JSON-RPC vocabulary is currently an implicit contract between the daemon and its own CLI/TUI. Both ship and break together, so the contract has never been written down. The moment any second consumer arrives — web UI, automation script, third-party integrator — that implicit contract becomes a load-bearing API surface by accident. Building the HTTP/WS layer is the right opportunity to extract the vocabulary into a versioned schema as a byproduct rather than after the fact.

### Market Data

- **Control-plane shape consensus (2025–2026):** Temporal, Dapr Workflow, Cloudflare Workflows, Hatchet, and Restate all expose REST/gRPC for control verbs plus a streaming endpoint per run for history/events. None ship browser-facing gRPC without a gateway. The "REST for control + streaming per run" pattern is dominant. (Sources: Temporal Frontend API docs, Hatchet streaming docs, Dapr Workflow overview, Cloudflare Workflows API reference.)
- **SSE vs WebSocket shift:** With HTTP/2 multiplexing removing SSE's 6-connection ceiling, the "default to WS for everything streamy" pattern has inverted. Multiple 2025–2026 sources (Ably, websocket.org, listiak.dev, getstream) now recommend SSE for one-way event tails because `Last-Event-ID` reconnect is built into browser `EventSource`. WebSocket retains the edge for low-latency client→server messaging — exactly the interactive-step / tool-approval case. This split is V2 in this idea; V1 collapses both onto WS to ship faster.
- **Bun framework adoption:** Elysia is the fastest Bun-native (~2.5M req/s, TypeBox→OpenAPI), but lock-in is real. Hono is portable across Bun/Node/Workers/Deno and uses Zod (already idiomatic in this codebase). Council selected Hono for portability optionality.
- **Local control-plane precedents:** Docker daemon's two-shape model (`/events` chunked-stream for read-only, `/attach` upgrade for bidirectional) is the canonical pattern for local daemons. Vite dev server uses a single WS for HMR; Tilt uses HTTP+WS for its browser UI; Skaffold is criticized for *lacking* this surface.
- **DNS rebinding against localhost dev tools is exploited, not theoretical:** Jenkins (CVE-2018-1000600 class), Redis, Ollama, and Docker Desktop have all been hit. Any new localhost daemon ships a CSRF-shaped attack surface unless `Host`/`Origin` allowlists, IPv4-only bind, and a falsification test are in place.

## Core Features

| # | Feature | Priority | Description |
|---|---|---|---|
| F1 | Transport-agnostic application-service layer | **Critical** | Extract `RunManager` operations (`startRun`, `listRuns`, `getRun`, `stopRun`, `attachRun`, `sendInput`) into a domain service. Existing JSON-RPC handlers refactor to delegate to it. The new HTTP/WS server consumes the same service. No business logic in route handlers. |
| F2 | Thin HTTP endpoint slice | **Critical** | `GET /runs` (list active + recent), `GET /runs/:id` (run detail snapshot), `POST /runs` (start from workflow path or inline workflow body), `POST /runs/:id/stop` (graceful then forceful). Hono + Zod schemas. |
| F3 | WebSocket attach + send (chat-style) | **Critical** | `WS /runs/:id/attach` with subprotocol carrying `fromSeq` resume, server→client event frames (replay backlog then live tail), and client→server `sendInput` frames. Reuses `RunManager.attachSubscriber` and the existing race-fixed gap-closing logic. |
| F4 | Shared Zod schema + auto-OpenAPI | **High** | Single source of truth: `domain/api-schema.ts` defines `RunSummary`, `RunDetail`, `RunEvent`, `AttachFrame`, `InputFrame`. JSON-RPC notifications and HTTP/WS responses both reuse these. `@hono/zod-openapi` serves the spec at `/openapi.json`. A 30-line markdown documents WS framing. |
| F5 | Loopback security baseline | **Critical** | Explicit IPv4 `127.0.0.1` bind, post-listen assertion that the bound address is *not* `::` or `0.0.0.0`, `Host` allowlist on HTTP, `Origin` allowlist on WS upgrade. One CI test simulates DNS rebinding (`curl -H "Host: evil.com"` expects 403) — failing this fails the build. |
| F6 | Operational guardrails | **High** | Max-connections cap, per-connection idle timeout, bounded outbound WS buffer that closes on overflow. Daemon shutdown drains WS clients (close frame + brief grace period) before closing the UDS listener. |
| F7 | Round-trip conformance test | **High** | One CI test: replay a recorded event log through the Zod schemas and re-render via the existing TUI parser. Catches drift between JSON-RPC encoding and HTTP/WS encoding cheaply. |
| F8 | Speciation-guard test | **Medium** | A test-only third adapter (stdin/stdout JSON) must drive the application service without `RunManager` changes. Enforces the "no business logic in transport handlers" rule before merge. |

## KPIs

| KPI | Target | How to Measure |
|---|---|---|
| TUI-parity coverage | 100% of TUI verbs reachable via HTTP+WS (list, start, stop, attach, send, live event stream) | Manual checklist + integration test exercising each verb end-to-end |
| Event-stream fidelity vs UDS | 0 dropped, 0 duplicated events across attach / resume / mid-flush reconnect, verified against TUI on the same run | Differential test: run TUI and WS client against the same run, compare event sequences byte-for-byte |
| Time-to-first-event on attach | < 100 ms p95 on localhost for runs with ≤1k events of backlog | Integration test measuring time from WS upgrade to first replayed event frame |
| Schema documented | OpenAPI served at `/openapi.json`, WS framing markdown in `docs/`, round-trip conformance test passing in CI | CI status; file existence + non-empty Zod schemas |
| Daemon footprint delta | < 25 MB RSS increase at idle; < 5 ms p95 regression on existing UDS JSON-RPC latency | Bench: `ps -o rss` before/after; integration test with N=100 idle WS connections + measured `daemon.doctor` latency |
| Loopback baseline enforced | DNS-rebinding falsification test passes in CI; startup asserts non-loopback bind impossible | CI status; one test per control (Host allowlist, Origin allowlist, bind assertion) |

## Feature Assessment

| Criteria | Question | Score |
|---|---|---|
| **Impact** | How much more valuable does this make the product? | **Must do** — unlocks every non-TUI consumer (UI, automation, monitoring) and is the prerequisite for the V2 replay feature |
| **Reach** | What % of users would this affect? | **Must do** — every run, every consumer category, universally |
| **Frequency** | How often would users encounter this value? | **Must do** — every start, every event, every input |
| **Differentiation** | Does this set us apart or just match competitors? | **Strong** — local agent runners with a documented HTTP+WS surface are rare; combined with the V2 replay stretch, it becomes competitive with hosted control planes for the local use case |
| **Defensibility** | Is this easy to copy or does it compound over time? | **Strong** — the application-service seam + Zod-schema contract compound; every future surface (SSE, gateway, gRPC) gets cheaper |
| **Feasibility** | Can we actually build this? | **Must do** — ~70% of the hard work (RunManager subscriber API, EventLog seq + resume, race-fix) is already shipped |

**Leverage type:** Compounding Feature. The API itself is a one-time build, but its existence unlocks (a) the future web UI, (b) the V2 replay/fork feature, (c) automation integration, and (d) future SSE/gateway adapters — each at progressively lower marginal cost because the application-service seam is the shared substrate.

## Council Insights

- **Recommended approach:** Mount HTTP+WS inside the daemon as thin adapters over a new transport-agnostic application-service layer. Hono + Zod. Thinnest credible endpoint slice (4 HTTP routes + 1 WS endpoint). Shared schemas as the byproduct contract. Lock the loopback security baseline as V1 non-negotiable. Defer SSE, AsyncAPI, auth, and full JSON-RPC parity.
- **Key trade-offs:**
  - **WS-only vs SSE+WS split:** SSE is the textbook fit for the monotonic resumable event log (free `Last-Event-ID` ⇄ `fromSeq` mapping). Council ruled WS-only correct *now* (one debug path, no proxy/browser to amortize SSE's cost) but mandatory the moment a browser, gateway, or long-replay window arrives. Architect partial-conceded; PE held firm on V1.
  - **JSON-RPC source-of-truth vs vocabulary source-of-truth:** The Thinker held firm that "JSON-RPC as canonical" is the load-bearing speciation risk. Mitigation: extract `domain/api-schema.ts` (Zod) consumed by *both* transports, treat neither as canonical at the type level.
  - **Endpoint slice vs full parity:** Full parity for a UI that doesn't exist is gold-plating. Thin slice (`GET /runs`, `GET /runs/:id`, `POST /runs`, `POST /runs/:id/stop`, `WS /runs/:id/attach`) lets the future UI surface real needs. Retry-step, doctor, daemon-shutdown, ps-all deferred.
  - **In-process vs gateway:** In-process for V1 (single maintainer, no isolation requirement). Application-service seam makes gateway extraction a 1-day refactor later.
- **Risks identified:**
  - Speciation risk if implementation drifts toward direct route → `RunManager` calls. Mitigation: speciation-guard test (F8).
  - HTTP/WS handlers blocking the JSON-RPC event loop, starving CLI/TUI. Mitigation: N-idle-connections + p95-latency integration test (KPI #5).
  - WS resume across mid-flush disconnect re-introducing the gap-closing race in a new shape. Mitigation: re-verify `fromSeq` semantics explicitly against WS lifecycle.
  - DNS rebinding turning a malicious webpage into a confused-deputy attacker against 127.0.0.1. Mitigation: loopback security baseline (F5).
  - Schema drift between JSON-RPC and HTTP/WS encodings. Mitigation: round-trip conformance test (F7).
  - Daemon shutdown closing the listener before draining open WS clients. Mitigation: shutdown sequence change — stop accepting → drain WS → existing teardown.
- **Stretch goal (V2+):** **Workflow replay & time-travel.** Use the existing `EventLog` to expose `GET /runs/:id/events?fromSeq=N&toSeq=M` for historical replay and `POST /runs/:id/fork-from?seq=N` to restart a workflow from any past step with modified input. Turns workflow-runner from "remote runner" into "agent debugger." This is the killer differentiator vs hosted competitors and is *architecturally enabled* by the V1 application-service seam. Also flagged: SSE for autonomous read-only run tail as a second V2+ addition once a browser dashboard arrives.

## Out of Scope (V1)

- **Authentication / bearer tokens / multi-user identity** — locked V1 constraint is localhost-only with no auth. Adding auth without a remote use case is premature hardening. V2 will add it when a remote consumer or shared-machine scenario lands.
- **SSE event tail endpoint** — council partial-conceded SSE is mandatory at "browser + long-replay + gateway"; none of those exist yet. WS carries both interactive and autonomous runs in V1. V2 adds SSE behind the existing application-service seam.
- **Retry-step, doctor, daemon-shutdown, ps `all=true` over HTTP** — TUI parity does not require these on day one. Defer until a UI explicitly needs them. Reduces V1 surface and avoids designing endpoints with no consumer feedback.
- **AsyncAPI 3.0 spec for WebSocket** — codegen tooling is still rough in 2026; a 30-line markdown doc beats a spec nobody reads. Revisit when a second WS consumer arrives.
- **Workflow registry / sharing / multi-workflow library** — the CLI takes a JSON path today; introducing a registry now would break the existing UX without a clear consumer. V3 territory.
- **Remote / LAN exposure** — locked V1 constraint; any non-loopback bind is a startup assertion failure. V2 evaluates remote alongside auth.
- **Gateway process extraction** — in-process is the V1 choice. The application-service seam makes extraction reversible (~1 day) but not a V1 deliverable.
- **WS send-queue drop-policy semantics** — V1 ships max-connections cap + idle timeout + bounded outbound buffer with close-on-overflow. Designing the drop policy requires real event-volume data the project does not have yet.
- **Workflow replay & fork-from-seq** — the V2 stretch direction; intentionally excluded from V1 to keep scope shippable. Architecturally enabled by V1; gated on V1 ship.

## Integration with Existing Features

| Integration Point | How |
|---|---|
| `src/infra/daemon/run-manager.ts` | Operations move to a new `domain/app-service.ts`; `RunManager` becomes the implementation of one of its dependencies. JSON-RPC handlers refactor to delegate. |
| `src/infra/daemon/event-log.ts` | Reused unchanged. `readEventsSince(fromSeq)` powers WS attach replay; the same call will power the V2 SSE endpoint with `Last-Event-ID` mapping. |
| `src/infra/daemon/rpc/server.ts` | Existing JSON-RPC server stays as a peer transport. Both it and the new HTTP/WS server call `app-service` instead of `RunManager` directly. |
| `src/commands/daemon.ts` | `makeShutdown()` extended to drain WS connections before closing the UDS listener. New HTTP/WS listener mounts alongside the UDS bind. |
| `src/infra/tui/_tui-source.ts` | Unchanged for V1 — TUI keeps using UDS JSON-RPC. V2 candidate: TUI switches to the same WS endpoint to validate parity in production. |
| `src/infra/daemon/handlers/*` | Handler bodies become 3-5 line delegations to `app-service`. Wire-level parsing/validation stays at the transport boundary. |

## Architecture Decision Records

- [ADR-001: V1 scope and architectural shape for the HTTP+WebSocket API](adrs/adr-001.md) — Hono + Zod, thin endpoint slice, transport-agnostic application-service seam, locked loopback security baseline, replay/SSE deferred to V2.

## Open Questions

- **WS subprotocol shape:** Should the WS frame envelope match the JSON-RPC notification shape exactly (e.g., `{method: "event.run.event", params: {...}}`) or use a leaner attach-scoped shape (`{type: "event", seq, payload}`)? Trade-off: JSON-RPC parity simplifies the speciation-guard but locks the public frame shape to internal naming.
- **`POST /runs` body shape:** Accept only `{workflowPath: string}` (matches CLI today) or also `{workflow: WorkflowJSON}` for inline submission? Inline submission is the prerequisite for the V3 registry but creates a "where does this file live?" question for `meta.json`.
- **`fromSeq` semantics on WS attach:** If the client requests `fromSeq=N` and `N` is below the ring-buffer window, do we (a) refuse and surface `truncated=true`, (b) read from disk silently, or (c) read from disk with an explicit truncation marker frame? Architect lean: (c) for cache-friendliness.
- **Daemon-side rate-limit on `POST /runs`:** A misbehaving local client could spawn many runs in a loop. Is per-second cap a V1 or V2 concern? Devil's Advocate did not raise this directly; flagging for review.
- **OpenAPI hosting:** Serve `/openapi.json` at the same port as the API, or only when the daemon is in a "dev" mode? Default lean: always-on; the API is localhost-only anyway.
- **Schema versioning strategy:** When the V2 replay endpoints arrive, do shared DTOs gain a `version` field or do we use URL versioning (`/v1/runs`, `/v2/runs`)? Decision deferred until V2 design, but flag here so V1 schemas leave room.
