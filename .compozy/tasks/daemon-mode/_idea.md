# Daemon Mode

## Overview

Convert `workflow-runner` from a foreground process whose lifecycle is bound to a single terminal into a long-running background daemon that supervises multiple agent workflows concurrently. A new CLI surface lets a solo developer start workflows from any terminal, attach and detach a TUI to any running workflow, queue messages to interactive steps without the TUI attached, and retry a step from its original kickoff prompt after a crash.

**Who it is for.** Solo developers running 2-4 long agent workflows in parallel across different projects, on a single workstation, who want their work to survive terminal close, SSH disconnect, and OS sleep — and who want to sample progress on each run without committing to a foreground session.

**Why it is valuable.** Today the tool cannot be trusted with anything longer than the user's attention span. Closing the terminal kills the agent subprocess and loses all progress. A daemon turns the runner from a demo into something a developer can leave running overnight, supervise opportunistically, and recover from when the inevitable crash or sleep happens.

**V1 ambition.** Ship the full multi-workflow daemon with attach/detach, CLI message queue, crash recovery via step retry, and daemon-restart discovery. Design the per-run event log to be replayable and self-contained from day one so V2 can add fork/diff/time-travel without a rewrite.

## Problem

A workflow today is a foreground process. The user types `bun src/index.ts workflows/who-is.json`, a TUI takes over the terminal, an agent subprocess runs, and the entire arrangement collapses if any of the following happens: terminal closes, SSH disconnects, laptop sleeps, the user runs another command, the agent crashes, the Bun process panics. There is no recovery path other than `--start step-2` (which the user has to remember and which loses everything that happened in step-1).

The user has explicitly stated the unmet need: "start new workflows using the same daemon, attach and detach a TUI to a running workflow." Today this is impossible because the runner has no notion of a `Run` separate from a process, no persistent state, no IPC surface, and a TUI that owns the renderer and the input loop in the same process as the workflow.

The architectural seams already favor this change. The Runner is stateless per-run; the MCP server already binds to port `:0` so per-run servers are trivial; `RunnerEvent`s are JSON-serializable; the TUI already has a (minimal) detach path. What is missing is a `Run` model, a persistence layer, an IPC transport, and a CLI subcommand surface — none of which require algorithmic novelty.

### Market Data

- **59%** of developers run three or more AI coding tools in parallel — the parallel-runs use case is broadly real, not a niche request. ([Uvik 2026 stats](https://uvik.net/blog/ai-coding-assistant-statistics/))
- **84%** of developers use or plan to use AI tools; **51%** use them daily — agent workflows are routine, which makes their fragility under terminal close a daily pain. ([Second Talent 2026](https://www.secondtalent.com/resources/ai-coding-assistant-statistics/))
- **MCP at 97M downloads** with **78%** of enterprise AI teams running ≥1 MCP-backed agent in production by April 2026 — the protocol layer workflow-runner depends on is now mainstream. ([Digital Applied](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol))
- Closest competitor signal: Anthropic's Claude Code shipped Agent View / `/bg` in May 2026 with a supervisor process and `respawn --all` for sleep recovery — confirming the market expects this capability. It is Claude-locked, chat-based, and has no step-graph or ACP interop. ([Claude Code Agent View deep dive](https://www.oflight.co.jp/en/columns/claude-code-agent-view-parallel-orchestration-2026))
- No surveyed competitor (Claude Squad, Crystal, Conductor, OpenHands, Vibe Kanban) combines step-graph workflows with attach/detach UX and headless message queueing.

## Summary / Differentiator

A `tmux`/`abduco`-shaped daemon over a step-graph workflow engine that is model- and editor-agnostic by virtue of being ACP- and MCP-native. The differentiating combination versus the field: typed step-graph resume (not chat resume), attach/detach as the primary UX (not a dashboard), per-step model/agent switching, and CLI message-send to interactive steps when no TUI is attached. The event log per run is shaped from day one to support V2 fork/diff, turning a reliability feature into a compounding moat.

## Core Features

| #   | Feature                              | Priority | Description                                                                                                                                       |
| --- | ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Background daemon over UDS           | Critical | Long-running process exposing a Unix domain socket at `$XDG_STATE_HOME/workflow-runner/daemon.sock` with `0600` permissions and a PID lockfile.   |
| F2  | Parallel workflow runs               | Critical | One daemon supervises N concurrent runs, each with its own MCP server (port `:0`), agent subprocess, state directory, and event log.              |
| F3  | Per-run state + event log            | Critical | Each run owns `runs/<run-id>/meta.json` (status, current step, timing) and `events.jsonl` (append-only, excludes `stream` events of kind `thought`). |
| F4  | Attach / detach TUI                  | Critical | TUI becomes a UDS client; attach replays the current step's backlog from disk then live-streams; detach is clean and leaves the run untouched.    |
| F5  | `retry-step` crash recovery          | Critical | After a crash, `workflow-runner retry-step <run-id>` re-spawns the failed step with its original kickoff prompt; banner clarifies LLM may differ. |
| F6  | CLI message queue to interactive steps | Critical | `workflow-runner send <run-id> <msg>` durably queues user input for an interactive step even when no TUI is attached.                              |
| F7  | Manual + auto-start daemon lifecycle | High     | `workflow-runner daemon` runs the daemon in foreground; any other subcommand auto-spawns the daemon if no socket is present, with race protection.|
| F8  | `ps` and `doctor` introspection      | High     | `ps` lists runs with id, workflow, current step, status, elapsed, TUI-attached state; `doctor` reports socket, lockfile, orphaned subprocesses, disk usage. |
| F9  | Daemon-restart run discovery         | High     | On startup, daemon re-reads `runs/`, marks any `status: running` as `status: crashed`, and exposes them to `ps`/`retry-step`. No silent auto-resume. |
| F10 | Event-log retention                  | Medium   | `events.jsonl` rotates to `events.1.jsonl` when it exceeds 50 MB; bounds per-run disk growth.                                                     |

## KPIs

| KPI                                                   | Target                                | How to Measure                                                                              |
| ----------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| Workflow survival across terminal close / SIGHUP / sleep | ≥ 99% (vs ~0% today)                  | Integration test: start workflow, send SIGHUP to TUI process, assert run progresses to completion. |
| Median `retry-step` latency (crash → step re-armed)   | < 30 seconds                          | Synthetic crash test: kill daemon mid-step, `retry-step`, measure to first `banner` event.  |
| Max concurrent workflows without observable degradation | ≥ 4                                   | Load test: start 4 workflows, assert each progresses; assert daemon CPU < 50% on a 4-core box. |
| TUI attach latency (cmd → first event rendered)        | < 1 second including backlog replay   | Time from `workflow-runner attach` invocation to first paint, measured against a run with ~1 MB of step backlog. |
| Per-run on-disk size after 1 hour of activity         | < 50 MB                               | Run a representative workflow for 1 hour, measure `events.jsonl` size; assert below cap.    |
| Time-to-first-workflow on fresh install               | < 2 minutes                           | Cold-install dry-run: `workflow-runner start workflow.json` → first banner, no manual daemon start. |

## Feature Assessment

| Criterion           | Question                                              | Score   |
| ------------------- | ----------------------------------------------------- | ------- |
| **Impact**          | How much more valuable does this make the product?    | Must do |
| **Reach**           | What % of users would this affect?                    | Must do |
| **Frequency**       | How often would users encounter this value?           | Must do |
| **Differentiation** | Does this set us apart or just match competitors?     | Strong  |
| **Defensibility**   | Is this easy to copy or does it compound over time?   | Strong  |
| **Feasibility**     | Can we actually build this?                           | Strong  |

**Leverage type:** Compounding Feature — the event log per run is the load-bearing primitive; it serves persistence, replay, audit, and resume in V1, and unlocks fork/diff/time-travel in V2 with no rewrite.

## Council Insights

- **Recommended approach:** Ship the full V1 (parallel runs + attach/detach + CLI queue + crash recovery via `retry-step` + daemon-restart discovery) over UDS with line-delimited JSON. The codebase's hexagonal seams make this cheaper than it looks. The event log per run is the single load-bearing abstraction.
- **Key trade-offs:**
  - Parallel runs in V1 increase blast radius (one daemon crash affects N workflows) versus shipping single-workflow first. Resolved by including daemon-restart recovery in V1.
  - "Resume from kickoff prompt" is semantically a *retry*, not a continuation. Resolved by renaming the verb to `retry-step` and emitting a visible "LLM output may differ" banner.
  - UDS + line-delimited JSON vs gRPC. Resolved in favor of JSON for debuggability and single-binary footprint (see ADR-001).
- **Risks identified:**
  - Resume divergence (non-deterministic LLM under retry) — mitigated by naming and banner.
  - Step outcome/banner ordering bug could produce wrong resume state — mitigated by `fsync` contract: step outcome to `meta.json` *before* next banner event.
  - Auto-start race between simultaneous CLI invocations — mitigated by PID lockfile with `flock` semantics.
  - Cost blowup from parallelism — mitigated by `ps` surfacing per-run elapsed + step count, `doctor` warning above active-subprocess threshold.
  - Daemon visibility under auto-start — mitigated by `doctor` subcommand.
- **Stretch goal (V2+):** Time-Travel Workflows — `workflow-runner fork <run-id> --at step-N` creates a new run inheriting state up to step-N then taking a different `handoff` edge; `workflow-runner diff <run-a> <run-b>` shows divergence points. Cheap *if and only if* the V1 event log is self-contained (each event carries step id + monotonic seq) and the daemon constructs run state purely by replaying the log.

## Integration with Existing Features

| Integration Point                          | How                                                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain/runner.ts` (Runner loop)       | Loop body unchanged; ownership moves from `main()` to a per-run task inside the daemon. The fsync-before-banner contract is added to the loop.       |
| `src/domain/runner.ts` (RunnerObserver)    | A new `EventLogObserver` (infra) writes filtered events to `events.jsonl`. The TUI observer becomes a UDS-streaming observer.                        |
| `src/infra/mcp/mcp-server.ts`              | One MCP server instance per run, spawned at run start, disposed at run end. Existing single-step `StepToken` logic is unchanged.                     |
| `src/infra/acp/agent-session.ts`           | Unchanged. Subprocess spawning, dispose, and SIGTERM/SIGKILL behavior carry over.                                                                    |
| `src/infra/tui/tui.ts`                     | Renderer/input handling preserved. `attach(runner)` is replaced by `attach(udsClient)`; input flows over the socket; backlog replays before live events. |
| `src/app/main.ts`                          | Splits into `cmd/daemon.ts` (long-running daemon entry) and `cmd/cli.ts` (subcommand dispatch); `main.ts` becomes a thin router.                     |
| `src/app/cli.ts`                           | Extended with subcommand parsing (`start`, `attach`, `detach`, `ps`, `send`, `retry-step`, `stop`, `doctor`).                                        |

## Sub-Features

- **Daemon core** — UDS listener, lockfile, run registry, graceful shutdown, restart discovery
- **Run lifecycle** — Run model, state directory, meta.json persistence, event log writer with fsync contract
- **Protocol** — line-delimited JSON over UDS; control RPCs + event subscription channel; ownership/perms checks
- **CLI subcommands** — argv parsing for the 8 subcommands; auto-start logic with race protection
- **TUI as UDS client** — replay-on-attach, live streaming, durable input queueing, clean detach
- **Crash recovery** — `retry-step` semantics, daemon-restart `crashed` marking, `doctor` health checks
- **Log retention** — size-based rotation; future hook for age-based cleanup

## Out of Scope (V1)

- **Full agent-conversation persistence (mid-thought resume)** — Persisting and replaying ACP session state across crashes is a research problem (LLM non-determinism, internal agent state, tool-call replay semantics). User explicitly chose kickoff-prompt-only recovery.
- **Silent auto-retry of crashed runs on daemon restart** — Restarting an LLM agent spends real money; doing so without consent violates observable-cost principle. V1 marks runs `crashed` and requires explicit `retry-step`. A `--auto-retry` flag may land in V2.
- **Multi-user / multi-host daemon** — UDS at `0600` is single-user by design; no authentication layer, no network exposure. Cross-host supervision is a different product.
- **Pause / resume mid-step** — Only step-boundary checkpointing in V1. Pausing inside an autonomous step would require ACP-level cancellation guarantees not yet in scope.
- **Web UI / REST API** — UDS only in V1. A separate ACP/HTTP bridge could come later but is not required for the solo-developer use case.
- **Budget enforcement / token quotas** — Only soft signals (`ps` elapsed time, `doctor` subprocess count warnings) in V1. Hard caps require provider integration out of scope.
- **Time-travel / fork / diff (Alternative 1 from opportunity scan)** — Deferred to V2; V1 must shape the event log to support it but does not implement the commands.

## Architecture Decision Records

- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — Adopts the council's hybrid V1 scope including parallel runs, attach/detach, CLI queue, `retry-step` recovery, daemon-restart discovery, and the UDS + line-delimited JSON transport; defers conversation persistence and auto-retry to V2.

## Open Questions

- **Run id format.** ULID, short nanoid, or human-memorable two-word slug? Affects CLI ergonomics (`attach kf2a` vs `attach calm-otter`). Defer to PRD.
- **Event-log binary footprint.** Are there events that carry large payloads (full prompt text, file diffs) that should be referenced by hash instead of inlined to keep `events.jsonl` under the 50 MB-per-hour cap? Needs measurement against a representative real workflow.
- **TUI replay default depth.** Default to "last step only" (per current draft) or "current step + previous step" so the user has context for the handoff? Trade-off between attach latency and orientation.
- **Daemon shutdown semantics on `stop <run-id>`.** Does `stop` SIGTERM the agent subprocess and mark the run `failed`, or does it mark `aborted` as a distinct status? Naming and resume eligibility both depend on this.
- **`send <run-id>` ordering with TUI attached.** If a CLI `send` arrives while a TUI is attached and the user is mid-typing, do messages interleave by arrival time, or does the TUI's draft always go first? Likely arrival-time, but worth confirming.
- **Workflow file path in `meta.json`.** Stored as absolute path (breaks on machine moves) or content hash (breaks on workflow edits)? Pick a strategy that matches the V2 fork/diff plan.
