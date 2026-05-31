# TechSpec: HTTP + WebSocket API for the workflow-runner daemon

## Executive Summary

This spec adds an in-process HTTP + WebSocket API to the daemon so a future web UI (the
primary consumer per the PRD) can reach every run capability the TUI has today. The API is a
set of **thin transport adapters over the existing `RunManager`**, which is already
transport-agnostic — no new service module or interface is introduced (ADR-003). HTTP routes
and the OpenAPI document are served by Hono + `@hono/zod-openapi`; the live view is a single
run-scoped WebSocket using Bun's native server (ADR-005). All wire shapes are defined once as
Zod schemas in a shared module so the JSON-RPC and HTTP/WS encodings cannot drift, verified by
a round-trip conformance test (ADR-001 F7).

The primary trade-off: **reusing `RunManager` directly (maximum simplicity, minimum churn)
instead of a compile-time service boundary** means the "no business logic in transport
handlers" rule is enforced by convention plus a speciation-guard test rather than by structure.
A secondary trade-off: a **lean, attach-scoped WS envelope** (ADR-004) gives the UI a clean
public contract decoupled from internal RPC method names, at the cost of two envelope shapes
whose **shared payload** (`RunEvent`) — not byte-identical frames — is what the conformance test
pins. The listener is mounted in-process (not a gateway), so daemon shutdown ordering and
event-loop sharing must be deliberate.

## System Architecture

### Component Overview

```
                 ┌──────────────────────── daemon process ───────────────────────┐
   CLI/TUI  ──UDS──▶  RpcServer ──▶ JSON-RPC handlers ─┐                           │
                 │                                      ├──▶  RunManager  ──▶ Runner/EventLog/Store
   Web UI  ──TCP──▶  Hono (Bun.serve) ─▶ HTTP handlers ─┘        (shared          │
   Web UI  ──WS───▶            └──────▶ WS attach handler ───────  service)        │
                 │  + Host/Origin allowlist, bind assertion, discovery file        │
                 └───────────────────────────────────────────────────────────────┘
```

- **`src/app/api/` (new)** — the HTTP/WS transport adapter: Hono app, route handlers, WS
  upgrade+attach handler, security middleware (`Host`/`Origin` allowlist), bind/assert logic,
  and the discovery-file writer. Mirrors the role of `src/infra/daemon/handlers/*` for the new
  transport. Handlers parse/validate (Zod), call one `RunManager` method, map errors. No
  business logic (ADR-003).
- **`src/app/api/schema.ts` (new)** — single source of truth Zod schemas: `RunSummary`,
  `RunDetail`, `RunEvent`, `AttachFrame` (server→client union), `InputFrame` (client→server),
  `StartRunRequest`, `EventsQuery`, `EventsPage`, `HealthReport`, `DiscoveryFile`. Reused by the
  HTTP/WS adapter and by the round-trip conformance test. Lives with the API adapter, not in
  `domain/`: these are transport/wire shapes, not domain entities (consistent with the
  domain-purity rule).
- **`RunManager` (modified)** — the shared application service (ADR-003). Gains a required
  `cwd` on `startRun`; everything else (`list`, `get`, `retryStep`, `stop`, `sendInput`,
  `attachSubscriber`, `openEventLog`) is reused unchanged.
- **`src/infra/daemon/daemon.ts` (modified)** — `runDaemon` mounts the Hono listener alongside
  `bindSocket`; `makeShutdown` drains WS clients and stops the listener before existing
  teardown; writes/removes the discovery file.
- **JSON-RPC handlers + CLI client (modified)** — `run.start` params and the CLI gain `cwd`
  (CLI sends `process.cwd()`), preserving current CLI behavior.

Data flow for a live view: UI opens `WS /runs/:id/attach?fromSeq=N` → handler reads backlog
via `EventLog.readEventsSince` → registers a `RunSubscriber` → flushes + gap-reads (reusing the
race-fixed ordering from `run-attach.ts`) → streams lean frames; UI `{type:"input"}` frames
call `RunManager.sendInput`.

## Implementation Design

### Core Interfaces

The shared schemas are the contract. Primary types other components depend on:

```ts
// src/app/api/schema.ts  (Zod = single source of truth, lives with the API adapter)
export const RunEvent = z.object({
  seq: z.number().int().positive(),
  ts: z.number(),
  stepId: z.string().nullable(),
  event: z.unknown(), // RunnerEvent union, validated structurally by the conformance test
});

export const AttachFrame = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: RunDetail }),
  z.object({ type: z.literal("backlog"), entries: z.array(RunEvent), truncated: z.boolean() }),
  z.object({ type: z.literal("event"), entry: RunEvent }),
  z.object({ type: z.literal("status"), status: RunStatus }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export const InputFrame = z.object({ type: z.literal("input"), message: z.string().min(1) });
export const StartRunRequest = z.object({ workflowPath: z.string().min(1), cwd: z.string().min(1) });
export const EventsQuery = z.object({ fromSeq: z.coerce.number().int().nonnegative().optional(),
                                      stepId: z.string().min(1).optional() });
export const EventsPage = z.object({ entries: z.array(RunEvent), truncated: z.boolean() });
```

`RunManager` is consumed directly; no `RunService` interface (ADR-003). The only signature
change:

```ts
// src/infra/daemon/run-manager.ts
async startRun(workflowPath: string, cwd: string): Promise<{ runId: RunId; slug: RunSlug }>;
// internally: new Runner(workflow, factory, mcp, { cwd, onStepBoundary })
```

Error mapping convention: every handler catches `RunManagerError` and maps `error.code`
(the `RpcErrorCode` numeric) to an HTTP status / WS `error` frame via one shared table.

### Data Models

- **`RunSummary`** (list rows) — mirrors `RunListEntry` from `protocol.ts`: `id`, `slug`,
  `workflowPath`, `currentStepId`, `status`, `startedAt`, `endedAt`, `attachedCount`.
- **`RunDetail`** (detail + attach `snapshot` frame) — `RunSnapshot` fields
  (`id`, `slug`, `workflowPath`, `status`, `currentStepId`, `visitedStepIds`, `startedAt`,
  `endedAt`) plus `attachedCount`.
- **`RunEvent`** — the wire shape of `EventLogEntry` (`seq`, `ts`, `stepId`, `event`).
- **`EventsQuery` / `EventsPage`** — `GET /runs/:id/events` input (`fromSeq?`, `stepId?`) and
  output (`{ entries: RunEvent[], truncated: boolean }`). Backed by `EventLog.readEventsSince`
  + an in-handler `stepId` filter; reuses the existing cap + `truncated` flag (ADR-006).
- **`HealthReport`** — minimal liveness: `{ status: "ok", pid, uptimeMs, activeRuns, version }`.
  No run contents (unauthenticated; ADR-002 risk).
- **`DiscoveryFile`** — `{ pid, apiPort, socket }`, written `0600` to `daemon.json` in the
  storage root (ADR-005).

No database changes. Event persistence (JSONL + ring buffer) is reused unchanged.

### API Endpoints

All bound to `127.0.0.1` only; all HTTP guarded by a `Host` allowlist, the WS upgrade by an
`Origin` allowlist (ADR-001).

| Method | Path | Description | Request | Success / Errors |
|---|---|---|---|---|
| GET | `/health` | Daemon liveness snapshot | — | 200 `HealthReport` |
| GET | `/runs` | List active + recent runs | `?all=bool` | 200 `{ runs: RunSummary[] }` |
| GET | `/runs/:id` | Run detail snapshot (id or slug-prefix) | — | 200 `RunDetail`; 404 unknown; 409 ambiguous prefix |
| GET | `/runs/:id/events` | Historical events pull (read-only) | `?fromSeq=N` `?stepId=X` (either/both/neither) | 200 `EventsPage` (`{entries, truncated}`); 404 unknown; 409 ambiguous |
| POST | `/runs` | Start a run | `StartRunRequest` (`workflowPath`, `cwd` — both required) | 201 `{ runId, slug }`; 400 invalid body/workflow; 429 run-limit |
| POST | `/runs/:id/stop` | Stop (graceful→forceful) | — | 200 `{ finalStatus }`; 404 unknown |
| POST | `/runs/:id/retry-step` | Retry failing step | — | 200 `{ resumedStepId }`; 404 unknown; 409 not retry-eligible |
| GET | `/openapi.json` | OpenAPI document (byproduct) | — | 200 spec |
| WS | `/runs/:id/attach` | Live view + input | `?fromSeq=N` (resume) | frames per `AttachFrame`/`InputFrame` (ADR-004) |

`:id` resolution reuses `RunManager.get` (exact id or unambiguous slug-prefix); ambiguous
prefix → 409 with candidate list, unknown → 404.

## Integration Points

This feature is internal to the daemon process; no third-party services. System boundaries it
touches:

- **`RunManager`** — direct dependency for all verbs (ADR-003).
- **`EventLog.readEventsSince` / `currentStepBacklog` / `flush`** — reused by the WS attach
  handler exactly as `run-attach.ts` uses them (ADR-004).
- **`Bun.serve`** — the HTTP/WS runtime, mounted in `runDaemon` (ADR-005).
- **Storage root** — the discovery file (`daemon.json`) lives beside the socket and lockfile.
- **Auth**: none (localhost-only, ADR-001). Authorization is the loopback + `Host`/`Origin`
  allowlist baseline, not identity.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/app/api/*` | new | Hono app, route + WS handlers, security middleware, bind/discovery. Med risk: event-loop sharing, WS lifecycle. | Build per ADR-004/005 with thin handlers. |
| `src/app/api/schema.ts` | new | Shared Zod DTOs + conformance source (transport-layer, not domain). Low risk. | Define schemas. |
| `src/infra/daemon/run-manager.ts` | modified | `startRun` gains required `cwd`. Low risk; localized. | Thread cwd into `new Runner`. |
| `src/infra/daemon/protocol.ts` | modified | `run.start` params gain `cwd`. Low risk; additive. | Add field; update handler. |
| `src/infra/daemon/handlers/run-start.ts` | modified | Pass `cwd` to `RunManager.startRun`. Low risk. | Update call. |
| `src/app/commands/start.ts` + `src/infra/client/*` | modified | CLI sends `process.cwd()` as `cwd`. Low risk; preserves behavior. | Populate field client-side. |
| `src/infra/daemon/daemon.ts` | modified | Mount listener; extend `makeShutdown` to drain WS + stop listener + write/remove discovery file. Med risk: shutdown ordering. | Implement bind/assert/drain sequence. |
| `docs/ws-protocol.md` | new | ~30-line WS framing doc. Low risk. | Write per ADR-004. |
| `package.json` | modified | Add `hono`, `@hono/zod-openapi`, `zod`. Low risk. | Add deps. |

## Testing Approach

### Unit Tests

- **Schema round-trip (conformance, ADR-001 F7):** replay a recorded `events.jsonl` through
  `RunEvent` (parse → serialize) and re-render via the existing TUI parser
  (`src/app/commands/_tui-source.ts` consumers); assert the rendered output matches, catching
  JSON-RPC↔WS payload drift. **Critical.**
- **Error mapping:** each `RunManagerError` code maps to the expected HTTP status / WS `error`
  frame.
- **Security middleware:** `Host`/`Origin` allowlist accepts `127.0.0.1`/`localhost`/`null`
  origin and rejects others (403).
- **Frame validation:** `AttachFrame`/`InputFrame` reject malformed frames; `StartRunRequest`
  rejects missing `cwd`/`workflowPath` (400).
- **Events query (ADR-006):** against a real temp event log — `?fromSeq=N` returns only
  `seq > N`; `?stepId=X` returns only that step; both compose; neither returns full history;
  exceeding the cap sets `truncated: true`; terminal-run reads open and close an owned handle.
- Mock boundary: stub `RunManager` for handler-shape tests; do **not** mock `EventLog`
  internals — use a real temp-dir event log for backlog/resume behavior.

### Integration Tests

- **TUI-parity matrix:** exercise each verb end-to-end against a live daemon (fixture session
  factory, `WORKFLOW_RUNNER_FAKE_FACTORY=1`): list, detail, start (with cwd), stop, retry-step,
  health, WS attach+send.
- **Event-stream fidelity (KPI):** run a TUI subscriber and a WS client against the same run;
  assert identical `RunEvent` sequences (0 dropped/duplicated) across attach, `fromSeq` resume,
  and mid-flush reconnect.
- **DNS-rebinding falsification (ADR-001 F5):** `curl -H "Host: evil.com"` → 403; WS upgrade
  with foreign `Origin` → rejected. Build-failing.
- **Bind assertion:** startup aborts if bound address ≠ `127.0.0.1`.
- **No-regression (KPI):** N=100 idle WS connections open; assert UDS `daemon.doctor`/`run.ps`
  p95 latency regression < 5 ms and idle RSS delta < 25 MB.
- **Speciation guard (ADR-001 F8):** a test-only stdin/stdout adapter drives `RunManager`
  through the thin-handler pattern with no `RunManager` changes.
- **Shutdown drain:** open WS clients receive a close frame and the listener stops before the
  socket/lockfile/discovery file are removed.

Environment: Bun test runner; fixture session factory; temp storage roots per test.

## Development Sequencing

### Build Order

1. **`src/app/api/schema.ts`** — shared Zod DTOs (`RunSummary`, `RunDetail`, `RunEvent`,
   `AttachFrame`, `InputFrame`, `StartRunRequest`, `HealthReport`, `DiscoveryFile`), colocated
   with the API adapter (transport shapes, not domain). No dependencies. Add `zod`, `hono`,
   `@hono/zod-openapi` to `package.json`.
2. **`RunManager.startRun(workflowPath, cwd)` + `run.start` param + CLI cwd** — depends on (1)
   for `StartRunRequest`. Thread cwd through `Runner`; CLI sends `process.cwd()`. Keeps existing
   tests green.
3. **Round-trip conformance test** — depends on (1). Lock the payload contract before handlers
   exist so later steps build against a verified shape.
4. **HTTP route handlers + OpenAPI (`src/app/api/` HTTP half)** — depends on (1),(2). `/health`,
   `/runs`, `/runs/:id`, `POST /runs`, stop, retry-step, and `GET /runs/:id/events` (reuses
   `openEventLog` + `readEventsSince` with the `stepId` filter, ADR-006); error-mapping table;
   `/openapi.json`.
5. **Security middleware** — depends on (4). `Host` allowlist (HTTP) + `Origin` allowlist (WS
   upgrade); the DNS-rebinding falsification test.
6. **WS attach+send handler** — depends on (1),(4),(5). Reuse the `run-attach.ts`
   backlog→subscribe→flush→gap-read ordering; emit lean frames; handle `?fromSeq`; bounded
   outbound buffer + idle timeout + max-connections.
7. **Listener mount + bind assertion + discovery file** — depends on (4),(6). Mount `Bun.serve`
   in `runDaemon`; assert loopback bind; write `daemon.json`.
8. **Shutdown drain** — depends on (7). Extend `makeShutdown` to drain WS + stop listener +
   remove discovery file before existing teardown.
9. **Integration suite + `docs/ws-protocol.md`** — depends on (4)–(8). Parity matrix, fidelity,
   no-regression latency/RSS, speciation guard, shutdown drain; write the framing doc.

### Technical Dependencies

- New runtime deps: `hono`, `@hono/zod-openapi`, `zod` (Bun-compatible; no infra setup).
- No external services, migrations, or team deliverables. Existing fixture session factory
  covers agent-free integration tests.

## Monitoring and Observability

Reuse the existing `DaemonLogger` (structured `{level, event, ...}`):

- **Metrics/log events:** `api.started` (port), `api.bindRejected` (non-loopback),
  `api.requestRejected` (Host/Origin, with offending value), `ws.attached`/`ws.detached`
  (runId, fromSeq, subscriberCount), `ws.bufferOverflowClosed` (runId), `api.shutdownDrain`
  (drained client count). Reuse `run.terminalPersistFailed` for run errors.
- **Health endpoint** doubles as the liveness probe (`activeRuns`, `uptimeMs`).
- **Alerting thresholds** (manual, single-maintainer): any `api.bindRejected` is fatal at
  startup; repeated `api.requestRejected` indicates a misconfigured/hostile client;
  `ws.bufferOverflowClosed` spikes indicate a slow consumer needing the deferred drop policy.

## Technical Considerations

### Key Decisions

- **Decision:** Consume `RunManager` directly as the shared service; no new module/interface.
  **Rationale:** it is already transport-agnostic and the port rule forbids an interface with
  one implementation. **Trade-off:** the seam is convention + test, not a compile-time boundary.
  **Rejected:** `domain/app-service.ts` (domain-purity violation, redundant); `RunService`
  interface (unjustified abstraction). See ADR-003.
- **Decision:** Lean, attach-scoped WS frames. **Rationale:** the connection is run-scoped, so
  `runId`-bearing RPC-parity frames are redundant and couple the public contract to internal
  names. **Trade-off:** two envelopes → conformance pins the shared payload, not frames.
  **Rejected:** JSON-RPC-parity envelope. See ADR-004.
- **Decision:** In-process Hono on `Bun.serve`, fixed loopback port 4517 + discovery file.
  **Rationale:** single maintainer, no isolation need; UI needs reliable port discovery.
  **Trade-off:** daemon owns a second listener (shutdown/event-loop care). **Rejected:**
  flag-only (UI breaks on override), ephemeral port (unstable for docs/manual use), gateway
  process. See ADR-005.
- **Decision:** `cwd` required over HTTP, CLI defaults to `process.cwd()`. **Rationale:** an
  HTTP caller has no ambient shell; silently using the daemon's cwd is a footgun. See ADR-002.

### Known Risks

- **Event-loop starvation** (med likelihood): HTTP/WS work delays UDS JSON-RPC. *Mitigation:*
  N-idle-connection p95 latency test; bounded outbound buffers.
- **WS resume race in new shape** (med): `fromSeq` reconnect re-introduces the gap-closing race.
  *Mitigation:* reuse the proven `run-attach.ts` ordering; explicit reconnect/close-code tests.
- **Confused-deputy via spawn path** (med, high impact): localhost-no-auth + arbitrary cwd →
  agent execution in any directory. *Mitigation:* non-negotiable loopback/Host/Origin baseline +
  DNS-rebinding build test (ADR-001/002).
- **Payload drift** (low): JSON-RPC vs WS encodings diverge. *Mitigation:* shared Zod `RunEvent`
  + round-trip conformance test on every build.
- **Shutdown closes listener before draining WS** (low): current daemon stops the listener
  first. *Mitigation:* explicit drain-then-teardown order in `makeShutdown` (ADR-005).

## Architecture Decision Records

- [ADR-001: V1 scope and architectural shape for the HTTP+WebSocket API](adrs/adr-001.md) —
  In-process Hono+Zod, thin slice, transport-agnostic seam, locked loopback baseline; SSE/
  gateway/replay/auth deferred.
- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](adrs/adr-002.md)
  — Pulls retry-step and health into V1 and makes the runner's working directory an explicit
  start parameter.
- [ADR-003: RunManager is the shared application service (no new seam module)](adrs/adr-003.md)
  — Both transports consume `RunManager` directly; no `domain/app-service.ts`, no `RunService`
  interface; thin handlers + speciation-guard test.
- [ADR-004: Lean, attach-scoped WebSocket frame envelope](adrs/adr-004.md) — `type`-discriminated
  public frames with implicit runId; conformance pins the shared `RunEvent` payload.
- [ADR-005: In-process Hono listener at a fixed loopback port with a discovery file](adrs/adr-005.md)
  — `Bun.serve` bound to 127.0.0.1:4517 (overridable), bind assertion, `daemon.json` discovery,
  drain-before-teardown shutdown.
- [ADR-006: Read-only historical events endpoint in V1](adrs/adr-006.md) — `GET /runs/:id/events`
  filterable by `fromSeq`/`stepId`, reusing `readEventsSince`; the read half of replay enters
  V1 while fork/time-travel and SSE stay deferred to V2.
