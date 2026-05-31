# PRD: HTTP + WebSocket API for the workflow-runner daemon

## Overview

workflow-runner orchestrates agentic workflows (opencode via ACP) as a local
Bun/TypeScript daemon. Today the daemon speaks only JSON-RPC over a Unix domain
socket, consumed by an in-tree CLI and a TUI. Any non-TUI consumer is locked out:
close the terminal and the only viewer of run state is gone; there is no path for a
browser tab, a second device, or an automation script to watch or drive a run.

This feature adds an HTTP + WebSocket API mounted inside the daemon process, exposing
enough surface that a web dashboard can match what the TUI does today: list, start,
stop, retry, attach to a live event stream, and send chat-style input. **V1 ships the
API only — no UI is being built yet.** It is the contract a future web UI will be built
against, and the prerequisite seam for later replay/debugging capabilities.

- **What problem it solves:** the daemon's run state is reachable only from an in-tree
  CLI/TUI over a private socket. There is no documented, programmatic surface for any
  other consumer.
- **Who it is for:** the primary V1 consumer is a **future web-UI developer** building a
  dashboard against a stable, documented, conformance-tested contract. Automation
  scripts and a second-device "is it done yet?" glance are direct secondary
  beneficiaries.
- **Why it is valuable:** it unlocks every non-TUI consumer category at once, and the
  transport-agnostic seam it introduces makes each future surface (SSE, gateway, replay)
  cheaper to add.

## Goals

- Expose a documented HTTP + WebSocket API, localhost-only, that lets a future UI reach
  every run capability a dashboard needs: list, detail, start, stop, retry-step, health,
  and a live attach+send stream.
- Deliver a **single source-of-truth contract** (shared schemas + auto-generated OpenAPI
  + short WS-framing doc) that both the new API and the existing JSON-RPC surface honor,
  so a UI never builds against a divergent or undocumented shape.
- Guarantee **event-stream fidelity**: a WS consumer sees the same events, in the same
  order, with no drops or duplicates, as the TUI watching the same run — including across
  attach, resume, and mid-flush reconnect.
- Hold a **non-negotiable loopback security baseline** so adding a localhost listener does
  not introduce a DNS-rebinding / confused-deputy attack surface.
- Add the API **without regressing** the existing CLI/TUI experience or the daemon's
  resource footprint.

Success is measured by the metrics in the Success Metrics section; the headline bar is
"a future UI developer can build a full dashboard against this API without reading the
daemon's source."

## User Stories

**Primary persona — Future UI developer (building a web dashboard):**

- As a UI developer, I want a documented list of runs (active and recent) so my dashboard
  can render a run overview without scraping logs.
- As a UI developer, I want a run-detail snapshot for a single run so I can render its
  status, steps, and current state on a detail page.
- As a UI developer, I want to start a run by specifying a workflow file and the directory
  it should run in, so a user can launch work against a chosen project from the browser.
- As a UI developer, I want to stop a run from the dashboard so a user can cancel work
  without dropping to a terminal.
- As a UI developer, I want to retry the failing step of a run from the dashboard, so a
  user can recover a failed run in place rather than re-running from scratch.
- As a UI developer, I want a live event stream for a run, with backlog replay on connect
  and a resumable tail, so the dashboard shows the run unfolding in real time and survives
  a reconnect without losing or duplicating events.
- As a UI developer, I want to send chat-style input to an interactive step over the same
  live connection, so a user can answer the agent from the browser.
- As a UI developer, I want a lightweight health endpoint so the dashboard can show whether
  the daemon is reachable before issuing control actions.
- As a UI developer, I want a machine-readable contract (OpenAPI + a WS-framing doc) so I
  can generate types and integrate without reverse-engineering the daemon.

**Secondary persona — Automation / scripting (the maintainer):**

- As a maintainer, I want to start, watch, and stop runs over HTTP from a script or another
  device, so I am not tied to the originating terminal.
- As a maintainer, I want a "is it done yet?" glance over HTTP from a second device, so I
  can check a long-running run without re-attaching the TUI.

**Edge cases:**

- As any consumer, when I reconnect to a run's stream after a dropped connection, I want to
  resume from where I left off without missing or re-seeing events.
- As any consumer, when I request a run that does not exist or has expired, I want a clear,
  predictable error rather than a hang.
- As any consumer, when I request a resume point older than the daemon retains in memory, I
  want a clear signal that the backlog was truncated rather than silent gaps.

## Core Features

Grouped by priority. All verbs are reachable over both the new API and the existing
JSON-RPC surface because they route through one shared application-service layer (see ADRs).

**Critical**

- **Run listing & detail (read).** Retrieve all active and recent runs, and fetch a single
  run's snapshot (status, steps, current state). The dashboard baseline.
- **Historical events pull (read).** Fetch a slice of a run's already-recorded events,
  filterable by sequence (everything after a known point) and/or by step, without holding a
  live stream open. Lets a dashboard render a step's transcript or page through history on a
  read-only panel. This is a pull of existing data only — not run forking or restart-from-a-
  past-step (those remain out of scope; see Non-Goals).
- **Run lifecycle control (start / stop).** Start a run by specifying a workflow file path
  and an explicit working directory (spawn path) for the runner; stop a run gracefully then
  forcefully. The explicit spawn path makes the working directory — implicit in the CLI's
  shell cwd — a first-class API input so a UI can launch runs across multiple projects.
- **Run recovery (retry-step).** Retry the failing step of a run, so a UI can recover a
  failed run in place. (Pulled into V1 — see ADR-002.)
- **Live attach + send (streaming).** A single live connection per run that replays the
  event backlog on connect, tails new events in real time, supports resuming from a known
  point after reconnect, and accepts chat-style input frames for interactive steps. Matches
  the TUI's live view and is fidelity-equivalent to it.
- **Loopback security baseline.** The listener binds to IPv4 loopback only and asserts at
  startup that it is not bound to a public address; HTTP enforces a `Host` allowlist and the
  live-connection upgrade enforces an `Origin` allowlist; a build-time test simulates a
  DNS-rebinding attempt and requires it to be rejected. Non-negotiable for V1.

**High**

- **Daemon health.** A lightweight, unauthenticated liveness/health snapshot a dashboard
  can poll to decide whether the daemon is reachable and render connection state. (Pulled
  into V1 — see ADR-002.)
- **Single source-of-truth contract.** Shared schemas define every run, event, and
  input/output shape once; an OpenAPI document is generated as a byproduct and served by the
  daemon, and a short markdown documents the live-stream framing and resume semantics. Both
  the API and JSON-RPC honor these shapes, so the contract a UI builds against cannot drift.
- **Operational guardrails.** A cap on concurrent connections, a per-connection idle
  timeout, and a bounded outbound buffer that closes a connection on overflow, so a stalled
  or abusive client cannot exhaust daemon resources. Daemon shutdown drains live connections
  cleanly before closing the existing socket.
- **Contract conformance check.** An automated check replays a recorded event log through the
  shared schemas and confirms the existing TUI parser still renders it, catching any drift
  between the JSON-RPC and HTTP/WS encodings cheaply on every build.

**Feature interaction:** Listing/detail/start/stop/retry/health are request/response control
verbs; attach+send is the long-lived stream. They share the same run identity and the same
schemas, so a UI lists a run, opens its stream, and issues control verbs against it as one
coherent surface. The shared service guarantees the same operation behaves identically
whether invoked over HTTP, the live connection, or the legacy socket.

## User Experience

The "user" of V1 is a developer integrating against the API; the end-user experience is
delivered by the future UI built on top of it. The journey:

1. **Discover the contract.** The developer fetches the served OpenAPI document and reads the
   short WS-framing doc — no source-diving required to learn the surface.
2. **Read run state.** The dashboard lists runs and opens a run-detail view, populated from
   the list/detail endpoints.
3. **Control a run.** The user starts a run (choosing a workflow file and a project
   directory), and can stop or retry-step it from the dashboard.
4. **Watch live.** The dashboard opens the live connection for a run, immediately renders the
   replayed backlog, then shows events as they happen. If the connection drops, it resumes
   from the last seen point with no gaps or duplicates.
5. **Interact.** For an interactive step, the user types a reply in the dashboard and it is
   delivered over the same live connection.
6. **Recover.** On failure, the user retries the failing step in place rather than restarting.

**Discoverability:** the OpenAPI document and WS-framing doc are the front door; both are
served/shipped with the daemon. **Accessibility/UI conventions** are out of scope for V1
(no UI is shipped); they become the future UI's concern. **Onboarding** for the developer is
"point a generator at the OpenAPI doc."

## High-Level Technical Constraints

- **Localhost-only, no authentication in V1.** The API is reachable only from the local
  machine; there is no auth, identity, or remote exposure. Any non-loopback bind is a startup
  failure.
- **Mounted inside the existing daemon process.** No second process or external service.
- **Must not regress existing consumers.** The CLI/TUI over the existing socket must keep
  working unchanged, within their current latency and the daemon's current footprint.
- **Stream fidelity is a hard requirement**, not best-effort: a streaming consumer must be
  observably equivalent to the TUI on the same run.
- **Security baseline is mandatory** (loopback bind + bind assertion, `Host`/`Origin`
  allowlists, DNS-rebinding rejection verified in the build).

This section deliberately states boundaries, not implementations; framework, schema, and
protocol choices live in the TechSpec and the referenced ADRs.

## Non-Goals (Out of Scope)

- **Authentication, tokens, or multi-user identity.** V1 is localhost-only with no auth.
- **Remote / LAN exposure.** Any non-loopback bind is a startup failure.
- **Workflow fork & restart-from-seq (time-travel debugging).** The marquee future direction —
  restarting a run from a past step with modified input (forking) — is architecturally enabled
  by this V1 seam but explicitly excluded from it. Captured as future direction only, with no
  committed phase. Note: the read-only *retrieval* of historical events is in V1 (see Core
  Features); only forking/restart and the streaming variant below remain deferred.
- **SSE read-only event tail.** The live stream carries both interactive and read-only runs in
  V1; a separate one-way streaming endpoint is future direction only.
- **`ps all=true` (full historical listing) over the API.** Deferred until a consumer needs it.
- **A formal async-API spec for the live channel.** A short markdown doc covers V1; a formal
  spec waits for a second streaming consumer.
- **Workflow registry / sharing / multi-workflow library.** The API takes file paths; a
  registry is later territory.
- **Separate gateway process.** In-process for V1; the shared seam keeps a later gateway cheap.
- **Outbound-buffer drop-policy semantics.** V1 caps connections, times out idle ones, and
  closes on overflow; a nuanced drop policy waits for real event-volume data.
- **A shipped web UI.** V1 is the API; the UI is a downstream effort.

## Phased Rollout Plan

### MVP (Phase 1) — the V1 API

All Critical and High features above:

- Read: list runs, run detail.
- Control: start (workflow path + spawn path), stop, retry-step.
- Health: daemon liveness/health snapshot.
- Live: attach with backlog replay + resumable live tail + chat-style send.
- Contract: shared schemas, served OpenAPI, WS-framing doc, conformance check.
- Security: loopback baseline with DNS-rebinding rejection verified in the build.
- Guardrails: connection cap, idle timeout, bounded outbound buffer, clean shutdown drain.

**Success criteria to consider V1 complete:** every listed verb is reachable over the API and
behaves identically to its JSON-RPC counterpart; a streaming consumer is byte-for-byte
event-equivalent to the TUI on the same run across attach/resume/reconnect; the security and
conformance checks pass in the build; the daemon footprint and existing-socket latency stay
within target (see Success Metrics).

### Future direction (post-V1, not scheduled)

No committed Phase 2. When a real need arrives, the seam built in V1 makes these cheap,
additive surfaces:

- **Fork & time-travel debugging** — restarting/forking a run from a past step with modified
  input. Gated on V1 ship and a concrete debugging need. (Read-only historical retrieval already
  ships in V1.)
- **SSE read-only tail** — a one-way streaming endpoint, justified once a browser, proxy, or
  long-replay window arrives.
- **Authentication & remote exposure** — when a remote or shared-machine consumer lands.

These are recorded here for direction only; each will get its own PRD/ADR if and when pursued.

## Success Metrics

- **TUI-parity coverage:** 100% of the targeted verbs (list, detail, start, stop, retry-step,
  health, live attach, send) reachable and working over the API. *Measure:* a checklist plus
  an end-to-end test exercising each verb.
- **Event-stream fidelity vs the TUI:** 0 dropped and 0 duplicated events across attach,
  resume, and mid-flush reconnect, verified against the TUI on the same run. *Measure:* a
  differential test comparing event sequences from a streaming client and the TUI.
- **Time-to-first-event on attach:** under ~100 ms at p95 on localhost for a run with up to
  ~1k events of backlog. *Measure:* a timed integration test from connect to first replayed
  event.
- **Contract documented & non-drifting:** OpenAPI served by the daemon, WS-framing doc present
  and non-empty, conformance check passing in the build. *Measure:* build status + artifact
  existence.
- **No regression to existing consumers:** under ~25 MB idle memory increase and under ~5 ms
  p95 latency regression on the existing socket surface with ~100 idle streaming connections
  open. *Measure:* before/after resource and latency benchmark.
- **Security baseline enforced:** DNS-rebinding rejection and non-loopback-bind-impossible
  assertions pass in the build. *Measure:* build status, one check per control.

## Risks and Mitigations

- **Adoption risk — the contract is awkward to build a UI against.** *Mitigation:* the primary
  consumer (UI dev) drove the V1 surface and metrics; the served OpenAPI + WS-framing doc are
  acceptance gates, not afterthoughts.
- **Scope-creep risk — V1 grows toward full parity / replay / auth before shipping.**
  *Mitigation:* Non-Goals are explicit and replay/SSE/auth are future-direction-only with no
  committed phase; the surface was deliberately bounded to dashboard table-stakes.
- **Security/adoption risk — a localhost no-auth API plus an arbitrary spawn directory invites
  a confused-deputy attack via a malicious web page.** *Mitigation:* the loopback security
  baseline (bind assertion, Host/Origin allowlists, DNS-rebinding rejection in the build) is a
  non-negotiable V1 gate, not a follow-up.
- **Regression risk — adding a listener degrades the CLI/TUI users rely on.** *Mitigation:* an
  explicit no-regression footprint/latency budget is a tracked success metric.
- **Competitive context — hosted control planes (Temporal, Hatchet, etc.) offer richer
  surfaces.** *Mitigation:* V1 does not compete on breadth; it targets the local single-binary
  niche and lays the seam for the replay differentiator competitors charge for.
- **Dependency risk — fidelity depends on the existing event log/resume behavior.**
  *Mitigation:* the conformance and differential tests pin fidelity against the TUI on every
  build, so any regression in the shared path is caught.

## Architecture Decision Records

- [ADR-001: V1 scope and architectural shape for the HTTP+WebSocket API](adrs/adr-001.md) —
  In-process HTTP+WS as thin adapters over a transport-agnostic application-service seam,
  shared schemas + auto-OpenAPI, locked loopback security baseline; SSE/gateway/replay/auth
  deferred.
- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](adrs/adr-002.md)
  — Pulls retry-step and a health endpoint into V1 for the future-UI consumer and makes the
  runner's working directory an explicit start parameter, all within the ADR-001 seam.

## Open Questions

- **Backlog-truncation signaling:** when a stream resume point is older than the daemon retains
  in memory, should the API refuse with a "truncated" flag, silently read older history, or
  read older history with an explicit truncation marker? (Product impact: how a UI communicates
  a gap to the user.)
- **Start rate-limiting:** should V1 cap how fast a single local caller can start runs to
  protect against an accidental loop, or is that a later concern?
- **Health payload contents:** what minimum information does a dashboard need from the health
  endpoint (liveness only vs. version/active-run count) without leaking run internals to an
  unauthenticated caller?
- **OpenAPI availability:** always served, or only in a dev mode? (Leaning always-on given the
  API is localhost-only.)
- **Contract versioning headroom:** should the shared shapes leave room for a version marker now
  so the future replay surface can evolve without breaking the UI contract? (Decision can defer,
  but flagged so V1 does not paint itself into a corner.)
