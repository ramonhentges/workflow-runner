# TechSpec: Daemon Mode

> Note: the template references Go for interface examples; this project is Bun/TypeScript with strict typing already established in `src/domain/`. All code blocks below use TypeScript to stay consistent with the codebase.

## Executive Summary

Daemon mode converts `workflow-runner` from a foreground process into a long-running background daemon that supervises multiple concurrent agent workflows over a Unix domain socket. The implementation extends the existing hexagonal architecture: a new pure-domain `Run` aggregate joins `Workflow`/`Runner`/`Step`; a `RunManager` in `infra/daemon/` owns the lifecycle of N concurrent runs each with its own `Runner`, `McpServer`, and per-run state directory; a JSON-RPC 2.0 server over NDJSON exposes the control and event-streaming protocol; the `Tui` is refactored to consume an event source instead of a `Runner` directly so it can host equally well in foreground tests or against a real daemon over the socket. The CLI surface (`start`, `attach`, `detach`, `ps`, `send`, `retry-step`, `stop`, `doctor`, `daemon`) lives in `app/commands/` and dispatches to `infra/client/`.

The primary technical trade-off is **operational simplicity over fault isolation**: the daemon runs every component in-process (per-run `McpServer`, per-run `Runner`, JSON-RPC server, event-log writer) rather than splitting them into separate processes. This keeps the code base small and the dependency graph linear, at the cost that a daemon-process bug affects all in-flight runs. The risk is bounded by daemon-restart discovery (ADR-001): orphaned runs are durably persisted as `events.jsonl` + `meta.json` per-run directories, the daemon re-discovers them on startup and marks them `crashed`, and `retry-step` re-spawns the failed step from its original kickoff prompt. A secondary trade-off is **explicit retry over silent auto-resume**: V1 never silently restarts a crashed run because LLM agent invocations cost real money and require user consent.

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ User terminal(s)                                                │
│                                                                 │
│  workflow-runner start ──┐    workflow-runner attach ─┐         │
│  workflow-runner ps      │    workflow-runner send    │         │
│  workflow-runner stop    │    workflow-runner doctor  │         │
└──────────┬───────────────┴────────────────────────────┴─────────┘
           │ argv                                                  
           ▼                                                       
┌─────────────────────────────────────────────────────────────────┐
│ src/app/commands/* — subcommand dispatchers                     │
│   - parse argv, validate flags                                  │
│   - call infra/client/ with normalized args                     │
│   - format response, set exit code                              │
└──────────┬──────────────────────────────────────────────────────┘
           │ in-process method calls                               
           ▼                                                       
┌─────────────────────────────────────────────────────────────────┐
│ src/infra/client/ — UDS JSON-RPC client                         │
│   - auto-spawn daemon if socket missing                         │
│   - open connection, send request, await response               │
│   - for attach: subscribe to event notifications, stream to TUI │
└──────────┬──────────────────────────────────────────────────────┘
           │ NDJSON over $XDG_STATE_HOME/workflow-runner/daemon.sock
           ▼                                                       
┌─────────────────────────────────────────────────────────────────┐
│ src/infra/daemon/ — long-running daemon process                 │
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────────────────────┐   │
│  │ JSON-RPC server │───►│ handlers/ (one file per method)  │   │
│  │ (NDJSON framed) │    └──────────────┬───────────────────┘   │
│  └─────────────────┘                   │                       │
│                                        ▼                       │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ RunManager — owns active Run instances                 │    │
│  │   per Run: { runner, mcpServer, eventLog, subscribers }│    │
│  └────────────────┬──────────────┬─────────────┬──────────┘    │
│                   │              │             │               │
│                   ▼              ▼             ▼               │
│           ┌──────────────┐  ┌──────────┐  ┌──────────────┐    │
│           │ Runner       │  │ McpSrv   │  │ EventLog     │    │
│           │ (domain)     │  │ (port:0) │  │ ring + jsonl │    │
│           └──────┬───────┘  └────┬─────┘  └──────────────┘    │
│                  │               │                            │
└──────────────────┼───────────────┼────────────────────────────┘
                   │ ACP stdio     │ MCP HTTP (loopback)        
                   ▼               ▼                             
              ┌─────────────────────────┐                        
              │ opencode acp subprocess │ (per step, per run)    
              └─────────────────────────┘                        
```

**Components:**

- `domain/run.ts` — Pure `Run` aggregate; tracks id, slug, workflow path, status, current/visited step ids, kickoff prompts per step, start/end timestamps. Status transitions are pure functions; no I/O.
- `domain/run-id.ts` — Pure id and slug generators with an injected random source.
- `infra/daemon/daemon.ts` — Daemon entry; binds UDS, owns lockfile, wires JSON-RPC server to handlers, performs run discovery on startup.
- `infra/daemon/run-manager.ts` — Holds the `Map<RunId, ActiveRun>` of running runs; coordinates `Runner` + `McpServer` + `EventLog` lifecycle.
- `infra/daemon/event-log.ts` — Per-run append-only `events.jsonl` writer plus the in-memory ring buffer used for attach replay.
- `infra/daemon/run-store.ts` — Disk layout: discovers and loads `meta.json`, persists status transitions, enumerates run directories.
- `infra/daemon/rpc/server.ts` — Connection-level NDJSON read loop; request dispatch; notification fan-out.
- `infra/daemon/handlers/` — One handler per JSON-RPC method.
- `infra/daemon/protocol.ts` — Shared types for JSON-RPC method names, params, results, and notification kinds; imported by both daemon and client.
- `infra/client/client.ts` — UDS connection logic, auto-spawn-on-missing-socket, JSON-RPC request/response, event-subscription consumer.
- `infra/client/format.ts` — `ps`/`doctor` output formatting (humanized durations, ATTACHED glyph, narrow columns).
- `infra/tui/tui.ts` — Refactored to consume `Observable<RunnerEvent>` instead of a `Runner`. Adds `/detach` slash command. Ctrl-C now kills the TUI only, prints a one-line "run still alive — `attach` to return" banner.
- `app/main.ts` — Subcommand dispatcher; routes to `app/commands/<subcmd>.ts`.
- `app/commands/` — One file per CLI subcommand (`daemon.ts`, `start.ts`, `attach.ts`, `ps.ts`, `send.ts`, `retry-step.ts`, `stop.ts`, `doctor.ts`).

**Data flow for the canonical `start` + `attach`/`detach` flow:**

1. User runs `workflow-runner start workflow.json`. `app/commands/start.ts` calls `client.runStart({workflowPath, attach: isTTY})`.
2. `infra/client/client.ts` connects to `$XDG_STATE_HOME/workflow-runner/daemon.sock`. If absent, forks the daemon binary detached and polls the socket for up to 2 seconds.
3. The JSON-RPC `run.start` handler in the daemon validates the workflow, creates a `Run` via `RunManager.startRun(workflowPath)`. The manager allocates an id+slug, creates the run directory, persists initial `meta.json`, spawns an `McpServer`, constructs a `Runner` with the existing `AcpAgentSessionFactory`, attaches an `EventLogObserver` to the runner, and starts `runner.run()` in the background.
4. Handler returns `{runId, slug}`. If client requested `attach`, it immediately opens a second JSON-RPC method call `run.attach({runId})`. Daemon's attach handler emits the ring-buffer backlog as notifications, then continues fan-out of live events.
5. The client's attach loop hands incoming notifications to a `Tui` instance backing the local terminal. User input lines from the TUI are sent back as `run.send` requests.
6. User types `/detach`; the TUI calls back into the client to close the attach subscription cleanly. The run continues in the daemon.

## Implementation Design

### Core Interfaces

The `Run` aggregate (pure domain, no I/O):

```typescript
// src/domain/run.ts
export type RunStatus =
  | "running" | "completed" | "failed" | "crashed" | "aborted";

export type RunId = string & { readonly __brand: "RunId" };
export type RunSlug = string & { readonly __brand: "RunSlug" };

export interface RunSnapshot {
  id: RunId;
  slug: RunSlug;
  workflowPath: string;
  status: RunStatus;
  currentStepId: StepId | null;
  visitedStepIds: StepId[];
  kickoffPrompts: Record<StepId, string>;
  startedAt: number;
  endedAt: number | null;
}

export class Run {
  static create(args: { id: RunId; slug: RunSlug; workflowPath: string }): Run;
  static fromSnapshot(snap: RunSnapshot): Run;
  snapshot(): RunSnapshot;
  markStepEntered(stepId: StepId, kickoffPrompt: string): void;
  markCompleted(): void;
  markFailed(reason: string): void;
  markCrashed(reason: string): void;
  markAborted(): void;
  eligibleForRetry(): boolean; // crashed | failed | aborted
}
```

The `RunManager` (infra, owns concurrent run lifecycle):

```typescript
// src/infra/daemon/run-manager.ts
export interface ActiveRun {
  run: Run;
  runner: Runner;
  mcpServer: McpServer;
  eventLog: EventLog;
  subscribers: Set<RunSubscriber>;
  runPromise: Promise<RunSummary>;
}

export class RunManager {
  constructor(
    storageRoot: string,
    sessionFactory: RunnerAgentSessionFactory,
  );
  async discoverOnStartup(): Promise<void>; // marks orphans as crashed
  async startRun(workflowPath: string): Promise<{ runId: RunId; slug: RunSlug }>;
  list(): RunSnapshot[];
  get(idOrSlugPrefix: string): ActiveRun | undefined;
  async retryStep(runId: RunId): Promise<void>;
  async stop(runId: RunId): Promise<void>;
  async sendInput(runId: RunId, message: string): Promise<void>;
  attachSubscriber(runId: RunId, sub: RunSubscriber): () => void;
  async shutdown(): Promise<void>;
}
```

The `EventLog` (per-run, append-only + ring buffer for replay):

```typescript
// src/infra/daemon/event-log.ts
export interface EventLogEntry {
  seq: number;
  ts: number;
  stepId: StepId | null;
  event: RunnerEvent;
}

export class EventLog {
  static async open(runDir: string): Promise<EventLog>;
  // Filters out stream events of kind "thought" before persisting.
  async append(event: RunnerEvent, stepId: StepId | null): Promise<EventLogEntry | null>;
  // Returns null if the buffer does not contain the current step's banner;
  // caller then falls back to readBackwardForCurrentStep().
  currentStepBacklog(currentStepId: StepId): EventLogEntry[] | null;
  async readBackwardForCurrentStep(currentStepId: StepId): Promise<EventLogEntry[]>;
  async close(): Promise<void>;
}
```

The JSON-RPC protocol surface (shared types):

```typescript
// src/infra/daemon/protocol.ts
export interface RpcMethods {
  "run.start":     { params: { workflowPath: string };
                     result: { runId: RunId; slug: RunSlug } };
  "run.ps":        { params: {};
                     result: { runs: RunListEntry[] } };
  "run.attach":    { params: { runId: RunId; fromSeq?: number };
                     result: { initialSnapshot: RunSnapshot } };
  "run.send":      { params: { runId: RunId; message: string };
                     result: { acceptedSeq: number } };
  "run.retryStep": { params: { runId: RunId };
                     result: { resumedStepId: StepId } };
  "run.stop":      { params: { runId: RunId };
                     result: { finalStatus: RunStatus } };
  "daemon.doctor": { params: {};
                     result: DoctorReport };
  "daemon.shutdown": { params: {}; result: {} };
}

export type RpcNotification =
  | { method: "event.run.event"; params: { runId: RunId; entry: EventLogEntry } }
  | { method: "event.run.statusChanged"; params: { runId: RunId; status: RunStatus } }
  | { method: "event.run.writerSlot"; params: { runId: RunId; isWriter: boolean } };
```

The TUI's new event-source dependency (refactor):

```typescript
// src/infra/tui/tui.ts (refactored signature)
export interface TuiEventSource {
  subscribe(observer: (event: RunnerEvent) => void): () => void;
  sendInput(text: string): Promise<void>;
  detach(): Promise<void>; // server-side cleanup on /detach
}

export class Tui {
  static async create(opts: { hooks?: { onQuit?: () => void } }): Promise<Tui>;
  attachSource(source: TuiEventSource): () => void; // replaces today's attach(runner)
  shutdown(): void;
}
```

### Data Models

**Disk layout** under `$XDG_STATE_HOME/workflow-runner/` (default `~/.local/state/workflow-runner/`):

```
workflow-runner/
├── daemon.sock              # UDS, mode 0600, owned by user
├── daemon.lock              # PID lockfile (fcntl flock)
├── daemon.log               # Rotating daemon-process log (separate from per-run logs)
└── runs/
    └── <run-id>/            # e.g. 2024-fk2a9xeh/
        ├── meta.json        # Run aggregate snapshot (RunSnapshot serialized)
        └── events.jsonl     # Append-only RunnerEvent log, "thought" filtered out
        └── events.1.jsonl   # Rotated when events.jsonl exceeds 50 MB
        └── events.2.jsonl
```

**`meta.json` schema** (RunSnapshot serialized) with explicit `schemaVersion`:

```typescript
interface MetaJson {
  schemaVersion: 1;
  id: RunId;           // 8-char base32 of crypto.randomUUID()
  slug: RunSlug;       // adjective-animal
  workflowPath: string; // absolute path; resolved at start time
  status: RunStatus;
  currentStepId: StepId | null;
  visitedStepIds: StepId[];
  kickoffPrompts: Record<StepId, string>;
  startedAt: number;   // ms epoch
  endedAt: number | null;
  endReason?: string;  // populated on crashed/failed/aborted
}
```

`meta.json` is written by `RunStore.persist(snapshot)` using atomic write (write to `meta.json.tmp` + `fsync` + `rename`). Writes happen on every state transition (`markRunning`, `markStepEntered`, `markCompleted`, etc.). **Critical invariant (ADR-001):** the `meta.json` write for a step transition completes (`fsync` returned) *before* the next `banner` event is emitted to observers — so crash recovery always sees the correct `currentStepId`.

**`events.jsonl` schema** (one `EventLogEntry` per line):

```typescript
interface EventLogEntry {
  seq: number;          // monotonic per run, starts at 1
  ts: number;           // ms epoch
  stepId: StepId | null;
  event: RunnerEvent;   // existing discriminated union from src/domain/runner.ts
}
```

Events of `type: "stream", kind: "thought"` are filtered out at write time (`EventLog.append` returns `null` for these; ring buffer and disk both skip them).

**Run id and slug generation** (`src/domain/run-id.ts`):

- `generateRunId(rand: () => string): RunId` — calls `rand()` (default `crypto.randomUUID()`), strips dashes, takes first 16 hex chars, base32-encodes to 13 chars, slices to **8** chars. Re-rolls on collision with active runs (checked by `RunManager`).
- `generateSlug(rand: () => number): RunSlug` — picks one from `ADJECTIVES` (200 entries) and one from `ANIMALS` (200 entries), joined with `-`. ~16 bits of entropy. Collisions with active runs trigger a re-roll; collisions with terminal-state runs older than 24h are allowed.
- Wordlists are static `const` arrays in `src/domain/run-id.ts`, hand-curated for kid-safe and easy-to-say words.

**`ps` row** (formatted by `infra/client/format.ts`):

```
RUN       SLUG           WORKFLOW          STEP       STATUS    ELAPSED   ATTACHED
fk2a9xeh  brave-otter    who-is.json       step-2     running   3m12s     ●
8x3kmn4p  wise-fox       feature-a.json    step-1     running   1h04m
2j5q8nx9  calm-badger    quick-task.json   step-3     completed 4m22s
```

The `ATTACHED` glyph is `●` when ≥1 subscriber is connected, empty otherwise.

### API Endpoints

The JSON-RPC surface (method, params, result, errors) — all over UDS.

| Method | Params | Result | Notes |
|---|---|---|---|
| `run.start` | `{ workflowPath: string }` | `{ runId, slug }` | Creates a new run; daemon writes `meta.json` and starts background `runner.run()`. Returns immediately. Error `WORKFLOW_INVALID` if the JSON is malformed; `RUN_LIMIT_REACHED` if a configurable cap is hit. |
| `run.ps` | `{}` | `{ runs: RunListEntry[] }` | Active runs first, then terminal-state runs ended within the last 24h, sorted by recency. Each entry includes the fields shown in the `ps` row above plus `attachedCount`. |
| `run.attach` | `{ runId, fromSeq? }` | `{ initialSnapshot }` | Synchronous reply with current snapshot; then daemon sends `event.run.event` notifications for backlog and live events. `fromSeq` lets a client resume after a transient disconnect. Resolves `runId` from an unambiguous prefix of id-or-slug. |
| `run.send` | `{ runId, message }` | `{ acceptedSeq }` | Queues a user message for the active interactive step. Error `RUN_NOT_INTERACTIVE` if the current step is autonomous. |
| `run.retryStep` | `{ runId }` | `{ resumedStepId }` | Only valid for `crashed`/`failed`/`aborted`. Re-spawns the failed step using the persisted kickoff prompt. Emits an `event.run.event` of type `log` carrying the "↻ retrying step-N — LLM output may differ" banner. |
| `run.stop` | `{ runId }` | `{ finalStatus: "aborted" }` | SIGTERM then 5 s grace then SIGKILL; returns when run reaches `aborted`. |
| `daemon.doctor` | `{}` | `DoctorReport` | Section-wise OK/WARN/FAIL: socket reachable, lockfile valid, no orphan ports, disk-usage budget, agent subprocess count vs threshold. |
| `daemon.shutdown` | `{}` | `{}` | Graceful: stops accepting new runs, lets existing runs continue if `--graceful=false-by-default` flag chosen; default behavior is to leave runs alive and exit (they'll be discovered as `crashed` next startup unless they complete cleanly first). |

Notifications (server-pushed, no `id`):
- `event.run.event` — one `EventLogEntry` for an attached subscriber.
- `event.run.statusChanged` — status transition; all subscribers receive it.
- `event.run.writerSlot` — informs a subscriber whether it currently holds the writer slot (for multi-attach; Phase 2).

Error codes (JSON-RPC `error.code`):
- `-32000` `UNKNOWN_RUN`
- `-32001` `WORKFLOW_INVALID`
- `-32002` `RUN_NOT_INTERACTIVE`
- `-32003` `RUN_NOT_RETRY_ELIGIBLE`
- `-32004` `AMBIGUOUS_PREFIX` (data: candidate ids)
- `-32005` `RUN_LIMIT_REACHED`
- `-32006` `DAEMON_SHUTTING_DOWN`

## Integration Points

The daemon does not call external services; all I/O is to local processes and the filesystem.

- **`opencode` CLI** (existing) — Spawned per step by `AcpAgentSessionFactory`. The daemon does not change this contract; the factory is unchanged.
- **MCP HTTP loopback** (existing) — Each per-run `McpServer` listens on `127.0.0.1:0`; the agent subprocess receives the URL via the existing kickoff prompt path. Unchanged.
- **Filesystem** — `$XDG_STATE_HOME/workflow-runner/` (fallback `~/.local/state/workflow-runner/`). All daemon-owned files written with `0600`/`0700` permissions.
- **System `notify-send`** — Not used in V1 (PRD chose daemon log + `ps` history over desktop notifications).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/index.ts` | modified | Becomes argv dispatcher into `main()`; no functional change. Low risk. | Update to call `main` with subcommand context. |
| `src/app/main.ts` | modified | Reduced to a thin subcommand router. Today's body moves into `app/commands/legacy-foreground.ts` if kept (likely deleted per PRD risk-mitigation). | Refactor; delete foreground path. |
| `src/app/cli.ts` | modified | Extended with subcommand parsing. Existing `parseCliArgs` becomes the parser for `start`/`attach`/etc., or is replaced by a per-subcommand parser. | Refactor argv parser; update `cli.test.ts`. |
| `src/app/commands/` | new | 8 new small files, one per subcommand. Low risk. | Create. |
| `src/domain/run.ts` | new | New `Run` aggregate. Pure logic, fully unit-testable. Low risk. | Create with full unit-test coverage. |
| `src/domain/run-id.ts` | new | Generators + 400-word wordlist constants. Low risk. | Create. |
| `src/domain/runner.ts` | modified | The Runner gains an `fsync`-before-banner contract: between resolving a step outcome and emitting the next step's banner, the Runner awaits a caller-injected `onStepBoundary(visited)` callback so `meta.json` can be persisted. Risk: alters Runner's existing contract — must not break `runner.test.ts`. | Modify with care; add new test for the boundary callback. |
| `src/infra/mcp/mcp-server.ts` | unchanged | Per-run instantiation (ADR-003) requires zero code change. No risk. | None. |
| `src/infra/acp/agent-session.ts` | unchanged | `AcpAgentSessionFactory` is consumed unchanged by `RunManager`. No risk. | None. |
| `src/infra/tui/tui.ts` | modified | Refactored to depend on `TuiEventSource` instead of `Runner` directly; adds `/detach` slash command; Ctrl-C behavior changes to print "run still alive" banner. Medium risk: existing main flow depends on direct `runner.provideInput` calls. | Refactor; update integration with the client. |
| `src/infra/daemon/` | new | Largest new surface: daemon entry, run manager, event log, run store, RPC server, handlers. Medium risk: holds the concurrency story. | Create with integration-test coverage. |
| `src/infra/client/` | new | UDS client and CLI output formatter. Low-medium risk. | Create. |
| `package.json` | modified | Add a `bin` field so `workflow-runner` is installable. No new deps. | Update. |

## Testing Approach

### Unit Tests

- `src/domain/run.test.ts` — `Run` status transitions, eligibility rules, snapshot round-trip. All deterministic; no I/O.
- `src/domain/run-id.test.ts` — Id and slug generation are deterministic given an injected random source; test no-collision behavior with a deterministic seed.
- `src/domain/runner.test.ts` — Existing tests stay; add a test that asserts the new `onStepBoundary` callback is awaited before the next `banner` event is emitted.
- `src/infra/daemon/event-log.test.ts` — Append, filter `thought` events, ring buffer wrap, currentStepBacklog returns `null` when the current step's banner is not in the buffer, disk fallback path produces identical ordering for the same inputs.
- `src/infra/daemon/run-store.test.ts` — Atomic write of `meta.json`; recovery of partial writes (the `.tmp` exists but `rename` did not happen); discovery of orphan `running` runs marks them `crashed`.
- `src/infra/daemon/rpc/server.test.ts` — Request/response correlation; notification delivery; error envelope shape; ambiguous-prefix behavior; subscription cleanup on connection close.
- `src/infra/client/format.test.ts` — Humanized duration formatting (`3m12s`, `1h04m`, `2d 3h`); narrow column layout; ATTACHED glyph rendering.

Mock boundaries:
- Tests of `RunManager` use a **fake `RunnerAgentSessionFactory`** that returns a controllable `RunnerAgentSession` (resolved outcome on demand). The real `AcpAgentSessionFactory` is exercised only in integration tests.
- Tests of `EventLog` use `Bun.tempDir()` for real filesystem I/O — Bun's tempdir is fast and the file API is the unit under test.
- Tests of the RPC server use an in-memory duplex pair (not a real socket) for transport.

### Integration Tests

`src/infra/daemon/__tests__/integration/` — Spawns the real daemon over a per-test temp socket (`mkdtemp` + `daemon.sock`), with a fake agent factory injected via an env var that the daemon honors only when `NODE_ENV=test`.

Scenarios:

1. **Lifecycle**: start a run, wait for completion, `ps` shows it as `completed`, snapshot on disk matches.
2. **Concurrent runs**: start 3 runs in parallel; all run to completion; final `ps` shows 3 `completed`.
3. **Attach/detach**: start a run, attach a fake TUI subscriber, receive the backlog and live events, detach, verify the run continues.
4. **Daemon-restart discovery**: start a run, hard-kill the daemon (`kill -9`), restart it, assert the run is `crashed`, `retryStep` it, verify it resumes from the failed step with the same kickoff prompt.
5. **Multi-attach (Phase 2)**: two subscribers on the same run, both receive the same events; writer-slot indicator reports correctly on attach order and detach promotion.
6. **`stop` semantics**: start a run, `stop` it, status reaches `aborted` within the grace window.
7. **Auto-spawn**: invoke a CLI command with no live socket, verify the daemon is auto-spawned and the command completes.

Environment dependencies: no `opencode` binary needed (fake factory); temp dirs only; tests must clean up sockets and processes in `afterEach`.

## Development Sequencing

### Build Order

1. **`src/domain/run.ts`** — no dependencies. Pure Run aggregate with full unit tests.
2. **`src/domain/run-id.ts`** — depends on step 1 (types). Generators + wordlists with unit tests.
3. **Runner `onStepBoundary` callback** — depends on step 1. Modify `src/domain/runner.ts` to accept and await the callback between step resolution and next-step banner emission. Update `runner.test.ts`.
4. **`src/infra/daemon/run-store.ts`** — depends on steps 1, 2. `meta.json` atomic read/write, run-directory discovery. Unit tests with real tempdir.
5. **`src/infra/daemon/event-log.ts`** — depends on step 1 (Run, RunnerEvent). Ring buffer + JSONL writer + disk fallback. Unit tests.
6. **`src/infra/daemon/protocol.ts`** — depends on steps 1, 5. Shared types. No tests (types only).
7. **`src/infra/daemon/rpc/server.ts`** — depends on step 6. JSON-RPC server over a generic duplex stream. Unit tests with in-memory transport.
8. **`src/infra/daemon/run-manager.ts`** — depends on steps 3, 4, 5, plus the existing `McpServer` and `AcpAgentSessionFactory`. Owns the lifecycle. Unit tests with a fake agent factory.
9. **`src/infra/daemon/handlers/*.ts`** — depends on steps 7, 8. One file per JSON-RPC method. Thin glue from RPC params to RunManager calls.
10. **`src/infra/daemon/daemon.ts`** — depends on steps 7, 8, 9. UDS bind, lockfile, wiring, startup discovery via RunManager.
11. **`src/infra/client/client.ts`** — depends on step 6 (protocol types). UDS connection, auto-spawn, JSON-RPC client.
12. **`src/infra/client/format.ts`** — depends on step 6. CLI output formatting. Unit tests.
13. **`src/infra/tui/tui.ts` refactor** — depends on step 6 (event type re-export). Refactor to consume `TuiEventSource`. Existing tests updated.
14. **`src/app/commands/*.ts`** — depends on steps 11, 12, 13. One file per subcommand.
15. **`src/app/main.ts` dispatcher** — depends on step 14. Argv → subcommand dispatch.
16. **`src/app/cli.ts` parser refactor** — depends on step 15. Per-subcommand parsing.
17. **Integration test suite** — depends on steps 10, 11, 13. Spawn real daemon with fake factory; cover the seven scenarios listed under "Integration Tests".
18. **Remove the foreground path** — depends on steps 14-17 working end-to-end. Delete the legacy main() body; update `bin` entry and `package.json` `scripts`.

### Technical Dependencies

- **Bun runtime** with Unix-socket support via `Bun.listen({unix: <path>})` (available since 1.0). No third-party UDS library.
- **`fcntl` flock** for the daemon lockfile — Bun exposes `Bun.write` and we use `fs.openSync` + `fcntl` syscall via the `node:fs` API. Linux/macOS only (Windows is not a target platform per the user's environment).
- **`crypto.randomUUID()`** from `node:crypto` for run-id seeds — available in both Node and Bun.
- No new npm dependencies introduced. The existing `@agentclientprotocol/sdk` and `@opentui/core` continue to power the agent session and the TUI respectively.

## Monitoring and Observability

The daemon is single-user, so "observability" is what the user sees in CLI output and in `daemon.log`, not metrics exported to an external system.

- **`daemon.log`** (`$XDG_STATE_HOME/workflow-runner/daemon.log`) — Structured JSON-lines per line: `{ts, level, event, runId?, msg, …}`. Levels: `INFO`/`WARN`/`ERROR`. Rotated when it exceeds 10 MB. Key events:
  - `daemon.started` (with version, pid, socket path)
  - `daemon.shutdown` (with reason)
  - `run.started` (runId, slug, workflow)
  - `run.statusChanged` (runId, fromStatus, toStatus, reason?)
  - `run.eventLogWriteFailure` (runId, error)
  - `discovery.orphanMarkedCrashed` (runId, reason)
  - `rpc.requestFailed` (method, errorCode, msg)
- **`workflow-runner doctor`** — On-demand health snapshot. Reports per subsystem:
  - **Socket**: reachable / unreachable.
  - **Lockfile**: valid (PID matches running process) / stale (PID dead) / contested.
  - **Active runs**: count.
  - **Active agent subprocesses**: count vs WARN threshold (default 8).
  - **Total disk usage** under `runs/` vs WARN threshold (default 1 GB).
  - **Orphan ephemeral ports** held by the daemon process (sanity check that `McpServer.close()` isn't leaking).
- **`workflow-runner ps`** — Per-run snapshot, the user's main observability surface.

No external metric export, no Prometheus, no traces in V1. If a future use case requires them, the daemon-log JSON format is a friendly upstream for parsers.

## Technical Considerations

### Key Decisions

- **Decision**: One `McpServer` instance per run.
  - **Rationale**: Preserves the existing single-step MCP semantics intact; spawn cost is negligible; isolation is naturally per-run.
  - **Trade-offs**: One ephemeral port per active run; not a constraint at V1 concurrency.
  - **Alternatives rejected**: Multi-tenant single server (refactors every tool-dispatch path); separate MCP child process per run (IPC complexity not justified).
  - **See**: [ADR-003](adrs/adr-003.md).

- **Decision**: JSON-RPC 2.0 over NDJSON for the daemon ↔ client protocol.
  - **Rationale**: Well-specified envelope with explicit notification semantics; debuggable with `nc -U` / `socat`; familiar idiom (LSP, ACP); ~150 LOC implementation, no third-party dep.
  - **Trade-offs**: Hand-rolled implementation requires its own maintenance; batch requests intentionally unsupported.
  - **Alternatives rejected**: Bespoke envelope (reinvents JSON-RPC poorly over time); length-prefixed framing (debuggability loss for no NDJSON-relevant benefit); third-party library (YAGNI for this size).
  - **See**: [ADR-004](adrs/adr-004.md).

- **Decision**: Domain `Run` aggregate + infra adapters (`infra/daemon/`, `infra/client/`) + app subcommand dispatcher.
  - **Rationale**: Honors the existing hexagonal seam; `Run`'s status transitions are genuinely pure business logic and belong in `domain`; the daemon and client are I/O adapters.
  - **Trade-offs**: ~10 small files under `infra/daemon/handlers/`; visually busy directory but each file stays small and `git blame`-friendly.
  - **Alternatives rejected**: Flat top-level `daemon/`/`cli/` packages (breaks existing architecture); pushing `Run` into infra (hides domain logic behind I/O).
  - **See**: [ADR-005](adrs/adr-005.md).

- **Decision**: Per-run ring buffer (N=1000 events) for attach replay, with `events.jsonl` disk fallback.
  - **Rationale**: Bounded memory in normal operation, correct behavior after daemon restart; supports the PRD's "<1s to first paint" target without making it conditional on disk speed.
  - **Trade-offs**: Two replay code paths must agree on formatting.
  - **Alternatives rejected**: Always-disk (latency depends on backlog size); in-memory only (post-restart attach sees no history); much larger buffer (just delays inevitable disk-path correctness work).
  - **See**: [ADR-006](adrs/adr-006.md).

Lesser decisions documented inline (no ADR):

- **Test strategy**: Unit tests on all new domain and infra modules + a targeted integration suite that spawns the real daemon with a fake agent factory. Full opencode-in-CI is out of scope for V1 (slow, flaky, requires authenticated CI).
- **Run-id and slug generation**: Use Bun's built-in `crypto.randomUUID()` for entropy plus hand-rolled wordlists (~200 adjectives, ~200 animals) bundled in `src/domain/run-id.ts`. No new dependencies.
- **`fsync`-before-banner contract**: The `Runner` accepts an injected `onStepBoundary` callback that the `RunManager` provides to persist `meta.json`. The Runner awaits this callback between resolving a step outcome and emitting the next step's `banner`, so crash recovery never sees a stale `currentStepId`.
- **Multi-attach writer slot (Phase 2)**: First-attached holds the writer slot; on detach, the longest-attached read-only subscriber is auto-promoted; daemon notifies all subscribers of the change via `event.run.writerSlot`. Documented as open in the PRD.

### Known Risks

- **Risk**: The `fsync`-before-banner contract is forgotten in a future Runner change; a crash between step outcome and next banner produces a stale `currentStepId` on recovery. **Likelihood**: medium over the long term. **Mitigation**: Integration test scenario #4 (kill the daemon mid-step transition, restart, assert correct `currentStepId`); explicit comment in `Runner.run()` documenting the contract.
- **Risk**: Bun's UDS API changes between minor versions. **Likelihood**: low (Bun 1.x has been stable on this API). **Mitigation**: Pin `bun-types` to a known-good range; the integration tests cover the actual socket behavior.
- **Risk**: `flock` on the lockfile behaves differently on macOS vs Linux. **Likelihood**: low. **Mitigation**: Test on both targets manually; document Linux/macOS support explicitly.
- **Risk**: A pathological workflow emits >1000 events before any attach (e.g., a step that produces a huge `log` flood). **Likelihood**: low; the buffer holds ~10 MB at the upper end and steps are bounded by agent runtime, not log throughput. **Mitigation**: If observed, raise the constant or add an LRU eviction tuning knob.
- **Risk**: The refactor of `tui.ts` from "depends on Runner" to "depends on TuiEventSource" breaks existing terminal rendering in subtle ways. **Likelihood**: medium. **Mitigation**: The TUI is exercised by the integration suite end-to-end against a real daemon; rendering bugs surface there.
- **Risk**: Auto-spawn races where two CLI invocations both try to start the daemon. **Likelihood**: medium for power users running scripts. **Mitigation**: `flock`-based lockfile; client polls the socket for up to 2 s after spawn before failing.

## Architecture Decision Records

- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — Council-debated V1 cut: parallel runs, attach/detach, CLI queue, retry-step, daemon-restart discovery; defers conversation persistence and auto-retry to V2.
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — Adopts a tmux/abduco-shaped UX over pm2-style supervisor; locks in command names, defaults, and error idioms.
- [ADR-003: One McpServer Instance Per Run](adrs/adr-003.md) — Each run owns its own `McpServer` on `127.0.0.1:0`; existing single-step semantics preserved; multi-tenant routing and child-process isolation both rejected.
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — Standard wire envelope with request/response/notification semantics; NDJSON framing; ~150 LOC in-house implementation, no third-party dep.
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — Honors existing hexagonal seams; `Run` is pure domain; daemon, client, and TUI live in `infra`; app becomes a thin subcommand router.
- [ADR-006: Attach Replay via Per-Run Ring Buffer + Disk Fallback](adrs/adr-006.md) — N=1000 events in-memory ring buffer for instant attach replay; disk-fallback path required for post-restart correctness.
