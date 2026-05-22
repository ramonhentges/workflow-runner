# TechSpec: Workflow Runner

## Executive Summary

The Workflow Runner extends the existing single-session ACP client (`src/index.ts`) into a step-sequenced orchestrator. It loads a workflow JSON config, then drives one step at a time: for each step it spawns a fresh `opencode acp` subprocess and ACP session, binds the step's persona via `setSessionMode` and model via `setSessionModel`, runs the step in `interactive` or `autonomous` mode, and advances when the agent calls one of two MCP tools — `handoff` or `finish`. Those tools are hosted by a single in-process HTTP MCP server that the runner owns, so tool handlers resolve the orchestration loop directly with no inter-process channel.

The implementation adds three focused modules to `src/` (`workflow.ts`, `mcp.ts`, `runner.ts`), reuses `client.ts` unchanged, and rewrites `index.ts` as the CLI entry point and TUI host. The primary technical trade-off: hosting an in-process HTTP MCP server couples the runner to `agentCapabilities.mcpCapabilities.http` (verified at `initialize`) in exchange for eliminating a separate process and a hand-written IPC protocol — a sharp simplification given opencode supports HTTP MCP natively.

## System Architecture

### Component Overview

| Component | Type | Responsibility |
|---|---|---|
| `src/index.ts` | modified | CLI argument parsing, TUI construction, input routing, wiring `runner` + `mcp` + UI, process lifecycle. |
| `src/workflow.ts` | new | Config types (`Workflow`, `Step`, `Edge`), `loadWorkflow()` — parse and validate the JSON file. |
| `src/mcp.ts` | new | In-process HTTP MCP server exposing `handoff` and `finish`; `createWorkflowMcpServer()`. |
| `src/runner.ts` | new | Step orchestration loop: per-step session lifecycle, mode/model binding, kickoff, outcome handling, banners, summary, failure handling. |
| `src/client.ts` | unchanged | `AcpClient` — ACP client-side handler implementation, reused as-is per step. |

**Data flow per step:**

1. `runner` renders a step banner through the `RunnerUi` callbacks.
2. `runner` calls `mcp.beginStep(step, resolve)` — arms the `handoff`/`finish` tools for this step's edges and registers the outcome resolver.
3. `runner` spawns `opencode acp`, builds a `ClientSideConnection` with a fresh `AcpClient`, and calls `initialize` (verifying `mcpCapabilities.http`).
4. `runner` calls `newSession({ cwd, mcpServers: [{ type: "http", name: "workflow", url: mcp.url, headers: [] }] })`.
5. `runner` validates `step.agent` against `availableModes`, then `setSessionMode(step.agent)` and `unstable_setSessionModel(step.model)`.
6. `runner` sends the kickoff prompt. Interactive steps then accept user turns from the TUI input field; autonomous steps run the single kickoff turn.
7. The agent calls `handoff` or `finish` on the in-process MCP server; the tool handler resolves the step's outcome promise.
8. `runner` cancels any in-flight turn, tears down the session and subprocess, and either advances to `nextStep` (passing the handoff `message`) or renders the end-of-run summary.

**External interactions:** `opencode acp` subprocesses (one per step, ACP over stdio/ndjson) and the in-process HTTP MCP server (one for the whole run, reached by each opencode subprocess over `127.0.0.1`).

## Implementation Design

### Core Interfaces

Workflow config types (`workflow.ts`):

```ts
export interface Edge {
  next_step: string;
  intent: string;
}

export interface Step {
  id: string;
  agent: string;
  description: string;
  mode: "interactive" | "autonomous";
  ide: string;
  model: string;
  edges: Edge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: Step[];
}
```

Orchestration control types (`runner.ts`):

```ts
export type StepOutcome =
  | { kind: "handoff"; nextStep: string; message: string }
  | { kind: "finish"; message: string }
  | { kind: "failure"; failedStep: string; reason: string };

export interface StepContext {
  step: Step;
  inboundMessage: string | null; // handoff message from the previous step
}
```

In-process MCP server (`mcp.ts`):

```ts
export interface WorkflowMcpServer {
  /** http://127.0.0.1:<port>/mcp — passed to session/new mcpServers. */
  readonly url: string;
  /** Arm handoff/finish for `step`; `resolve` fires when a tool is called. */
  beginStep(step: Step, resolve: (outcome: StepOutcome) => void): void;
  close(): Promise<void>;
}

export function createWorkflowMcpServer(): Promise<WorkflowMcpServer>;
```

Loader and runner entry points:

```ts
/** Parse + validate a workflow file. Throws WorkflowConfigError on bad input. */
export function loadWorkflow(path: string): Promise<Workflow>;

export interface RunOptions {
  workflow: Workflow;
  startStepId: string;        // entry step, or --start override
  cwd: string;
  mcp: WorkflowMcpServer;
  ui: RunnerUi;               // banner/log/summary/input callbacks into the TUI
}

export function runWorkflow(opts: RunOptions): Promise<RunSummary>;
```

### Data Models

`RunSummary` — produced when the run ends (`runner.ts`):

```ts
export interface RunSummary {
  visited: string[];          // step ids, in visit order
  finishMessage: string;      // message from the finish tool, or "" on failure
  durationMs: number;
  failure?: { failedStep: string; reason: string };
}
```

`RunnerUi` — the callback surface the TUI implements so `runner.ts` stays free of rendering:

```ts
export interface RunnerUi {
  banner(step: Step, index: number, total: number): void;
  log(message: string, color?: string): void;
  setInteractive(enabled: boolean): void;     // show/hide the input field
  setStatus(text: string, color?: string): void;
  summary(summary: RunSummary): void;
}
```

**Config validation rules** (`loadWorkflow`): the file must parse as JSON; `steps` must be a non-empty array; every step must have a non-empty `id`, `agent`, `model`, and a `mode` of exactly `interactive` or `autonomous`; step `id`s must be unique; every `edge.next_step` must reference an existing step `id`. Any violation throws `WorkflowConfigError` with a message naming the offending step/field. The `--start` step id, when given, must match a step.

### API Endpoints

The runner exposes no HTTP API to users. Its only programmatic surface is the two MCP tools served by the in-process MCP server. Tool definitions are regenerated per step (each step is a new session, hence a new `tools/list`), reflecting the current step's edges.

**`handoff`** — choose the next step and pass a message to it.
- Input: `{ next_step: string, message: string }`. `next_step` is constrained to an enum of the current step's `edges[].next_step` values; each edge's `intent` is included in the tool/parameter description to guide routing. Omitted entirely when the step has no edges.
- Behavior: the handler validates `next_step` against the current step's edges, resolves the outcome as `{ kind: "handoff", ... }`, and returns a success result. An invalid `next_step` resolves `{ kind: "failure", ... }` (halt-and-report per PRD).

**`finish`** — end the workflow.
- Input: `{ message: string }` — a closing summary message.
- Behavior: resolves the outcome as `{ kind: "finish", message }` and returns a success result. Always available, regardless of edges.

## Integration Points

- **opencode via ACP** — one `opencode acp` subprocess per step, ACP/JSON-RPC over ndjson stdio (the pattern already in `index.ts`). The runner verifies `agentCapabilities.mcpCapabilities.http` at `initialize` and exits with a clear message if absent. `OPENCODE_ENABLE_QUESTION_TOOL=1` is kept in the subprocess env.
- **In-process HTTP MCP server** — a minimal hand-rolled JSON-RPC/HTTP endpoint (using `node:http`) that hosts the `handoff`/`finish` tools, bound to an ephemeral `127.0.0.1` port resolved before the first session is created. No authentication (loopback only; `headers: []`).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| `src/index.ts` | modified | Rewritten from a single-session loop into CLI entry + TUI host wired to `runner`. Medium risk — largest change. | Parse `<workflow.json>` and `--start`; build TUI; implement `RunnerUi`; call `runWorkflow`. |
| `src/workflow.ts` | new | Config types and `loadWorkflow` validator. Low risk — pure logic. | Create module with types + validation. |
| `src/mcp.ts` | new | In-process HTTP MCP server (hand-rolled JSON-RPC/HTTP). Medium risk — port binding, lifecycle. | Create module; manage server start/close. |
| `src/runner.ts` | new | Orchestration loop and failure handling. Medium risk — concurrency between turns and tool callbacks. | Create module implementing `runWorkflow`. |
| `src/client.ts` | unchanged | `AcpClient` reused per step via a fresh instance. No risk. | None. |
| `package.json` | modified | Add `test` script (`bun test`). Low risk. | Update scripts. |
| `workflows/who-is.json` | unchanged | Serves as the manual E2E fixture. No risk. | None. |

## Testing Approach

### Unit Tests

Run with `bun test`. Target the pure logic, no ACP or MCP runtime needed:

- **`workflow.test.ts`** — `loadWorkflow`: valid `who-is.json`-shaped config; rejects malformed JSON, empty `steps`, missing `id`/`agent`/`model`, invalid `mode`, duplicate step ids, and an `edge.next_step` pointing at a nonexistent step. Each rejection asserts the `WorkflowConfigError` names the offending field.
- **Handoff target resolution** — the edge-validation function used by the `handoff` handler: accepts a declared edge target, rejects an undeclared one.
- **Summary formatting** — `RunSummary` → rendered summary text: visited-steps list, finish message, duration; failure variant.

Mocks: none required — these functions are pure. The handoff-validation function is extracted from `mcp.ts` so it is testable without starting a server.

### Integration Tests

Manual E2E, documented as a repeatable procedure:

- Run `bun src/index.ts workflows/who-is.json`. Confirm: `step-1` shows the input field (interactive), routes via user intent, the agent writes `./agent.txt`; the chosen autonomous step (`step-2` or `step-3`) hides the input, streams thinking, writes its file, and finishes; the end-of-run summary lists visited steps and the TUI stays open.
- Run with `--start step-2` and confirm the run begins mid-workflow.
- Failure checks: an invalid config halts before any subprocess starts; a config whose step `agent` is not a valid mode halts at that step with a clear message.

Environment dependency: `opencode` on `PATH`, authenticated, with the `big-pickle` model available.

## Development Sequencing

### Build Order

1. **`workflow.ts`** — config types and `loadWorkflow` with full validation. No dependencies.
2. **`workflow.test.ts`** — unit tests for the loader. Depends on step 1.
3. **`mcp.ts`** — in-process HTTP MCP server with `handoff`/`finish` and the extracted edge-validation function. Depends on step 1 (`Step`, `Edge`) and the `StepOutcome` type.
4. **MCP unit tests** — handoff target resolution and summary formatting. Depends on step 3 (and the `RunSummary` type from step 5's declarations; declare shared types in step 1/3 first).
5. **`runner.ts`** — `runWorkflow`: per-step session lifecycle, `setSessionMode`/`setSessionModel`, kickoff composition, outcome handling, failure detection, summary. Depends on steps 1 and 3, and reuses `client.ts`.
6. **`index.ts` rewrite** — CLI parsing (`<workflow.json>`, `--start`), TUI construction, `RunnerUi` implementation (banners, log, input show/hide, summary), wiring to `createWorkflowMcpServer` and `runWorkflow`. Depends on steps 1, 3, and 5.
7. **`package.json` update** — add the `test` script (`bun test`). Required before execution.
8. **Manual E2E pass** — run `who-is.json` and the failure checks. Depends on all prior steps.

### Technical Dependencies

- `opencode` CLI on `PATH`, authenticated, must report `mcpCapabilities.http: true` — confirmed against opencode's native remote-MCP support.
- `bun` runtime (already in use).

## Monitoring and Observability

This is a local terminal application; observability is the run log itself.

- **Status line** — current state: connecting, starting step `<id>`, awaiting agent, halted.
- **Logged events** — step banner (id, agent, model, mode), session created, mode/model set, tool calls and updates (existing `handleSessionUpdate`), `handoff` decision (`next_step` + message), `finish`, and every failure with the failing step id and reason.
- **Exit status** — process exits `0` on `finish`, non-zero on any failure, so the runner is scriptable.

## Technical Considerations

### Key Decisions

- **In-process HTTP MCP server** (ADR-002). Rationale: tool handlers resolve the orchestration loop directly. Trade-off: depends on `mcpCapabilities.http`. Rejected: stdio MCP + IPC socket; stdio MCP + reading `rawInput` from session updates.
- **`agent` → ACP session mode; `mode` → runner-side control** (ADR-003). Rationale: `agent` names an opencode persona exposed as an ACP session mode; `interactive`/`autonomous` are not opencode modes. Trade-off: depends on `step.agent` being in `availableModes`. Rejected: treating `mode` as the session mode; injecting the persona via the prompt.
- **Fresh subprocess + session per step** (ADR-001). Each step is fully isolated; only the handoff `message` crosses the boundary.
- **A few focused modules.** `workflow.ts` / `mcp.ts` / `runner.ts` added beside the existing files — no new package or directory (YAGNI).
- **Kickoff prompt composition.** Each step is started with one prompt: the step `description` plus, when present, `Context from previous step: <handoff message>`. Routing guidance reaches the agent through the `handoff` tool's per-edge `intent` descriptions, not the prompt.

### Known Risks

- **Per-step startup latency** — spawning a subprocess + session per step is visibly slow. Likelihood: certain, low severity. Mitigation: a "starting step…" status; subprocess pooling deferred to a later phase.
- **`unstable_setSessionModel`** — an unstable ACP method. Likelihood: medium over time. Mitigation: isolated in one session-setup function; a model-set failure is a step failure.
- **Autonomous step ends without a tool call** — the kickoff turn completes with no `handoff`/`finish`. Likelihood: medium. Mitigation: when `prompt()` resolves with the outcome promise still pending on an autonomous step, the runner resolves a `failure` outcome (halt-and-report).
- **Agent crash mid-step** — the `opencode acp` subprocess exits unexpectedly. Mitigation: an `exit` listener resolves a `failure` outcome with the step id and exit code.
- **Turn still running when a tool resolves the outcome** — the agent may emit more output after calling `handoff`. Mitigation: on outcome, the runner calls `connection.cancel()` before tearing the session down.

## Architecture Decision Records

- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — Build the runner as one persistent TUI advancing step by step with a fresh session per step; rejected a headless console runner and a full workflow IDE.
- [ADR-002: In-process HTTP MCP server for the handoff and finish tools](adrs/adr-002.md) — Host `handoff`/`finish` in an in-process HTTP MCP server so tool handlers resolve the orchestration loop directly; rejected stdio + IPC and stdio + session-update parsing.
- [ADR-003: Step `agent` maps to an ACP session mode; `mode` is runner-side control](adrs/adr-003.md) — Bind `agent` via `setSessionMode` and `model` via `setSessionModel`; interpret `interactive`/`autonomous` purely in the runner; rejected treating `mode` as a session mode.
