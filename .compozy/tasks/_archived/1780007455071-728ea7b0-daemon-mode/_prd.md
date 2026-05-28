# PRD: Daemon Mode

## Overview

`workflow-runner` today is a foreground process: the agent subprocess, the MCP server, the TUI, and the user's terminal are all bound to a single lifecycle. Closing the terminal, suspending the laptop, or hitting any crash destroys all in-flight work. This PRD specifies a long-running background daemon that supervises multiple agent workflows concurrently, and a CLI surface that lets a developer start, attach to, supervise, and recover workflows from any terminal.

The product targets a solo developer running 2-4 long agent workflows in parallel across different projects, on a single workstation. The shape of the experience is modelled on terminal multiplexers (tmux, abduco): a workflow is a **session** you attach to and detach from, the daemon is invisible plumbing, and the TUI is the canonical view of a running session. Crash recovery is a single CLI command that retries the failed step with its original kickoff prompt.

This change converts the runner from a demo into a tool the developer can trust with overnight runs, supervise opportunistically, and recover from when crashes or sleep happen.

## Goals

- Workflows survive terminal close, SSH disconnect, OS sleep, and TUI exit — measured by integration test reaching ≥99% of completions under SIGHUP injection.
- A developer can start and supervise at least 4 concurrent workflows from a single CLI on commodity hardware without degraded responsiveness.
- After a crash, recovering a workflow takes < 30 seconds and a single CLI command, with semantics that are unambiguous about whether agent state is preserved.
- Attaching to a running workflow takes < 1 second to first paint, including replay of the current step's backlog.
- Per-run disk footprint stays under 50 MB per hour of activity through bounded logging.
- A fresh-install user reaches "first workflow running" in under 2 minutes, with no manual daemon start required.
- The CLI surface is small enough to keep in the user's head: one binary, one mental model, named commands that mirror tmux/abduco/docker idioms already known to the target audience.

## User Stories

### Primary Persona — The Solo Multi-Workflow Operator

- As a developer, I want to start a workflow that keeps running after I close the terminal, so I can leave it executing overnight without dedicating a tmux pane to it.
- As a developer, I want to start a second and third workflow from any terminal while the first is still running, so I can parallelize work across projects without juggling tmux sessions.
- As a developer, I want a single `ps` command that shows all my running workflows, the step each is on, how long it has been running, and whether a TUI is attached, so I can quickly see the state of my agent fleet.
- As a developer, I want to attach a TUI to any running workflow, see what's happening, and detach without disturbing the run, so I can sample progress between meetings.

### Primary Persona — The Recovering User (same developer, post-crash)

- As a developer whose laptop just woke from sleep, I want `ps` to immediately tell me which runs are alive and which crashed, so I'm not guessing.
- As a developer, I want to retry a crashed step with a single command using the original kickoff prompt, so I don't have to dig through workflow JSON or remember `--start` syntax.
- As a developer, I want clear visible signalling that `retry-step` is a fresh agent invocation (not a continuation), so I don't expect mid-thought continuity from a non-deterministic LLM.

### Primary Persona — The Drive-By Supervisor (same developer, between meetings)

- As a developer pairing over SSH or jumping in between calls, I want to attach to an interactive step, send a message or two, and detach in seconds — without leaving the run worse than I found it.
- As a developer who wants to nudge an interactive step without committing to a TUI session, I want a CLI command to send a message and walk away, knowing the agent will see it.
- As a developer pair-programming, I want two TUIs to be able to view the same run at the same time, so my collaborator and I can both see what the agent is doing.

### Secondary / Edge Cases

- As a developer running my first workflow after install, I want the daemon to start itself silently, so the zero-config experience matches today's foreground tool.
- As a developer running `workflow-runner start workflow.json | tee output.log`, I want the command to detect the non-TTY environment and behave as if `-d` were passed, printing the run-id for my script to capture.
- As a developer whose daemon crashed mid-run, I want the daemon to come back, list my orphaned runs as `crashed`, and offer them for `retry-step` — without silently spending tokens auto-restarting them.

## Core Features

### F1 — Background daemon with auto-spawn (Critical)

A long-running process that supervises all active workflows. The daemon is invisible to users by default: any CLI subcommand that needs it spawns the daemon silently on first use (gpg-agent style), prints one line to stderr on first spawn (`workflow-runner: starting daemon`), and otherwise stays out of the way. `workflow-runner daemon` runs the daemon in the foreground for explicit control or debugging. A lockfile prevents simultaneous spawn races.

**Functional requirements:**
- Auto-spawn on any subcommand if no live daemon socket is found, with a startup timeout of ≤ 2 seconds.
- Single stderr line on first spawn; silent on subsequent invocations.
- Failure to spawn must produce a loud, actionable error pointing at the relevant diagnostic.
- `workflow-runner daemon` in foreground is the same daemon process the auto-spawn would launch.
- Lockfile contains daemon PID; stale lockfiles (PID dead) are reclaimed automatically.

### F2 — Run as session: start, attach, detach (Critical)

The product treats each workflow execution as a session. `start <workflow.json>` launches a new run; by default it auto-attaches a TUI in the current terminal, exactly as today's foreground tool feels. The user detaches via the `/detach` slash command inside the TUI, leaving the run alive in the daemon. `attach <run-id>` re-opens a TUI on the named run.

**Functional requirements:**
- `start <workflow.json>` creates a new run and, in a TTY, auto-attaches a TUI. In a non-TTY (piped) environment, behaves as if `--detach`/`-d` were passed and prints the run-id to stdout.
- `start --detach <workflow.json>` (or `-d`) always starts in the background and prints the run-id.
- `attach <run-id>` opens the TUI on the named run. With no argument and exactly one running run, attaches to that one. With no argument and multiple runs, errors with a listing. With no argument and no runs, errors with a helpful "no runs; start one with: workflow-runner start <workflow.json>".
- `/detach` typed in the TUI leaves cleanly without affecting the run.
- Ctrl-C in the TUI kills the TUI only (the run continues), and a brief "run still alive — `attach` to return" banner is printed on exit. This matches the tmux contract users already expect.
- The TUI replays the current step's event backlog from disk before live-streaming new events. Attach to first paint must be < 1 second for typical step backlogs.

### F3 — Run identifiers: short id + slug, prefix matching (Critical)

Each run is identified by a short opaque id and an auto-generated two-word slug, both unique within the daemon's lifetime. Both forms are accepted on input, and any unambiguous prefix resolves (`attach kf2` or `attach brave`). `ps` displays both side by side.

**Functional requirements:**
- Run id is short and typeable; slug is in `adjective-animal` form.
- The CLI accepts the full short id, the full slug, or any unambiguous prefix of either. Ambiguous prefixes produce an error listing the candidates.
- Both forms are stable for the run's full lifetime, including across daemon restarts.

### F4 — `ps` and `doctor` introspection (Critical)

`workflow-runner ps` lists every run the daemon knows about, with a narrow scannable layout. Terminal-state runs (completed, failed, crashed, aborted) remain visible for approximately 24 hours so the user can review what happened while detached. `workflow-runner doctor` reports daemon health, socket reachability, lockfile validity, orphaned subprocesses, and per-run disk usage.

**Functional requirements:**
- `ps` default columns: `RUN` (short id), `SLUG`, `WORKFLOW` (basename), `STEP` (current or last step id), `STATUS`, `ELAPSED` (humanized: `3m12s`, `1h04m`, `2d`), `ATTACHED` (marker glyph when ≥1 TUI is currently attached).
- `ps` shows active runs first, then terminal-state runs sorted by most-recently-ended. Terminal-state runs older than ~24 hours are hidden by default. A flag exposes the full history.
- `doctor` reports each subsystem with a one-line OK/WARN/FAIL plus context; exit code is non-zero if any FAIL.

### F5 — `retry-step` crash recovery (Critical)

After a workflow crashes (daemon crash, agent crash, OS sleep losing the subprocess, etc.), the developer recovers it by running `workflow-runner retry-step <run-id>`. The named step is re-spawned from scratch with the original kickoff prompt that was sent the first time. The CLI and TUI both surface a visible "↻ retrying step-N — LLM output may differ" banner so the semantic is unambiguous: this is a fresh agent invocation, not a continuation.

**Functional requirements:**
- `retry-step <run-id>` is only valid for runs in `crashed` or `failed` status; running runs are rejected with a clear error.
- The original kickoff prompt for the failed step must be persisted at the time it was first sent, not reconstructed at retry time.
- The retry banner must appear in both the CLI output of `retry-step` and the TUI on next attach, and must include the step id and a one-line disclaimer about non-determinism.
- After a successful `retry-step`, the run status transitions back to `running` and progress continues from that step onward.

### F6 — Headless CLI message queue for interactive steps (Critical)

`workflow-runner send <run-id> <message>` durably queues a message for the current interactive step of the named run. The message survives the daemon and is delivered to the agent whether or not a TUI is attached, in arrival order with any messages typed in attached TUIs.

**Functional requirements:**
- `send` is only valid when the run is on an interactive step; sending to an autonomous step is rejected with a clear error.
- The message is recorded in the run's event log so attached and future TUIs see it.
- Ordering with messages from attached TUIs is by arrival time at the daemon.
- Multi-line messages via stdin: `workflow-runner send <run-id> -` reads from stdin until EOF.

### F7 — Daemon-restart run discovery (High)

When the daemon restarts (crash, reboot, manual stop/start), it discovers all run directories on disk, identifies runs that were in `running` status (and therefore are now orphaned), and marks them `crashed` so they appear in `ps` and become eligible for `retry-step`. The daemon does **not** silently auto-resume any run; recovery is always an explicit user action in V1.

**Functional requirements:**
- On startup, daemon enumerates run directories and reads each `meta`.
- Any run in `running` status transitions to `crashed` with a timestamp and a reason ("daemon restart").
- `ps` shows these crashed runs in the recent-terminal-state section.

### F8 — Multi-attach (broadcast) with single-writer input (High)

Multiple TUIs may attach to the same run simultaneously. All attached TUIs receive the same event stream. Input is single-writer: exactly one attached TUI at a time owns the right to send user messages to the run; other attached TUIs see input as read-only. The writer slot is held by the first-attached TUI; when it detaches, the next-attached TUI is promoted; the writer state is visible to all attached TUIs.

**Functional requirements:**
- `attach` on a run that already has TUIs attached succeeds and joins as a read-only observer.
- The TUI displays an indicator of whether it currently holds the writer slot.
- When the writer detaches, the daemon promotes the longest-attached read-only TUI, and notifies all attached TUIs of the change.
- CLI `send` messages always flow through the daemon's queue and are not subject to the writer-slot restriction.

### F9 — `stop` with graceful-then-forceful semantics (High)

`workflow-runner stop <run-id>` ends a running run cleanly. The daemon sends SIGTERM to the agent subprocess, waits a bounded interval, and escalates to SIGKILL if necessary. The run transitions to status `aborted` (distinct from `failed`, which means the workflow itself reached a failure outcome). Aborted runs are eligible for `retry-step`.

**Functional requirements:**
- `stop` returns only after the run has reached `aborted` status.
- The graceful interval before SIGKILL escalation is short enough to keep the command interactive (≤ 5 seconds).
- `stop` on a run that is not running (already terminal-state) is a no-op success with a clarifying message.
- The event log records the stop event with the requesting user action.

### F10 — Per-run event log with bounded growth (Medium)

Each run produces an append-only event log on disk capturing every observable event except agent "thinking" streams (per the user's explicit choice in the idea phase). The log is the source of truth for backlog replay on attach, post-mortem inspection, and (in V2) fork/diff/time-travel. Logs rotate when they exceed 50 MB per run.

**Functional requirements:**
- Events are persisted before the next step's banner event is emitted (no in-flight events lost on crash).
- Event filter excludes `stream` events of kind `thought`.
- Rotation: once `events.jsonl` exceeds 50 MB, it is renamed to `events.N.jsonl` and a fresh `events.jsonl` is started. Backlog replay reads across rotations transparently.
- A run directory survives daemon restart and can be hand-inspected with standard tools (`jq`, `cat`, `grep`).

## User Experience

### Key personas
- **The Solo Multi-Workflow Operator**: starts and supervises 2-4 concurrent runs; lives in `start`, `attach`, `ps`, `/detach`.
- **The Recovering User**: post-crash; lives in `ps`, `retry-step`, occasionally `doctor`.
- **The Drive-By Supervisor**: lives in `attach`, `send`, `/detach`.

### Primary user flows

**Flow A — Start a workflow that survives terminal close (today's most-broken flow):**
1. User runs `workflow-runner start workflows/who-is.json`.
2. Daemon auto-spawns (first time only): one stderr line, then silence.
3. TUI auto-attaches in the same terminal; user sees the familiar banner and the agent's first output streaming in.
4. User types `/detach` (or closes the terminal entirely).
5. The run continues in the daemon. The user goes to lunch.
6. User runs `workflow-runner ps` in any terminal — sees the run still alive with current step and elapsed time.
7. User runs `workflow-runner attach <run-id-or-slug-prefix>` — TUI replays the current step's backlog (< 1 sec to first paint), then resumes live-streaming.

**Flow B — Run several workflows in parallel:**
1. User runs `workflow-runner start workflows/feature-a.json` — auto-attaches, then `/detach`.
2. In a different terminal, user runs `workflow-runner start -d workflows/feature-b.json` — daemon launches the run in background, prints the new run-id.
3. User runs `workflow-runner ps` — sees both runs with their slugs (`brave-otter`, `wise-fox`), current steps, elapsed times, and an `ATTACHED` glyph next to feature-a if a TUI is currently attached.

**Flow C — Recover from a crash:**
1. User's laptop wakes from sleep. They run `workflow-runner ps`.
2. Daemon was killed by the suspend; on next CLI invocation it auto-spawned, scanned the run directories, marked the prior runs as `crashed`.
3. `ps` shows the runs with status `crashed` and the last step that was active.
4. User runs `workflow-runner retry-step <run-id>` — sees a clear "↻ retrying step-N from kickoff prompt; LLM output may differ from the previous attempt" banner in the CLI.
5. Optionally attaches a TUI to watch the retry. Run resumes from that step.

**Flow D — Queue a message to an interactive step you're not attached to:**
1. User is in a meeting; an interactive step is waiting for input on a run.
2. User runs `workflow-runner send <run-id> "yes, proceed with the migration"`.
3. The message is queued at the daemon and delivered to the agent.
4. Later, user attaches and sees their queued message in the transcript alongside the agent's response.

**Flow E — Pair-programming over the same run:**
1. User and collaborator both run `workflow-runner attach <run-id>` (collaborator over SSH).
2. Both see the same live event stream. The first-attached TUI shows a `[writer]` indicator; the second shows `[read-only]`.
3. The collaborator types `/detach` after a few minutes; the daemon does not promote anyone because no one else is attached as read-only.
4. User keeps interacting normally.

### Onboarding & discoverability

- `workflow-runner` with no arguments prints the subcommand list, equivalent to `workflow-runner --help`.
- Every subcommand has `--help` describing its purpose, arguments, and common flags.
- The first time the daemon auto-spawns, the single stderr line is the only signal of its existence; users curious enough to investigate find `workflow-runner doctor` in `--help`.
- Error messages are actionable: when `attach` finds no runs, it tells the user the exact command to start one.
- The `/help` slash command inside the TUI lists slash commands (`/detach`, `/quit`, etc.).

### Accessibility

- No graphical UI in V1; all interaction is keyboard-driven via terminal.
- TUI must remain usable in monochrome / low-color terminals (the attached-state glyph and writer indicator must be distinguishable without color).
- All CLI output is plain text and pipeable; `ps` and `doctor` output is grep-friendly.

## High-Level Technical Constraints

- **Single host, single user.** The daemon is bound to a user-owned Unix domain socket with `0600` permissions in `$XDG_STATE_HOME/workflow-runner/`. Multi-user or multi-host operation is explicitly out of scope.
- **Existing protocol compatibility.** The daemon must continue to use ACP for agent subprocess communication and MCP for tool calls (handoff/finish). The existing per-step `StepToken` mechanism is preserved.
- **Workflow JSON format unchanged.** The existing workflow JSON schema (id, steps, agent, model, mode, edges) is the input to `start` without modification. No workflow file needs to be edited to opt into daemon mode.
- **Performance targets** (user-perceived):
  - TUI attach to first paint: < 1 second for typical step backlogs.
  - `retry-step` to first banner event: < 30 seconds median (dominated by agent subprocess spawn).
  - `ps` invocation latency: < 200 ms even with 10+ active runs.
  - Daemon idle CPU: < 1% on a 4-core machine with no active runs.
- **Storage constraints.** Per-run event log capped at 50 MB before rotation; `meta` updates must be durable (no acknowledged step transition lost on crash).
- **Backward compatibility.** None required — there is a single current user and no in-the-wild scripts depending on today's foreground invocation. The daemon-mode CLI fully replaces today's `bun src/index.ts <workflow.json>` flow.

## Non-Goals (Out of Scope)

- **Full agent-conversation persistence.** Resuming mid-thought (ACP session replay) is a research problem and explicitly out of V1; recovery preserves the kickoff prompt only.
- **Silent auto-retry of crashed runs.** Restarting an LLM agent spends real money; V1 marks orphaned runs `crashed` and requires explicit `retry-step`. A `--auto-retry` flag is V2 material.
- **Multi-user or multi-host daemon.** UDS at `0600` is single-user by design; no authentication layer; no network exposure.
- **Pausing inside a step.** Only step-boundary checkpointing in V1. Pausing within an autonomous step would require ACP-level cancellation guarantees not yet in scope.
- **Web UI or REST/HTTP API.** UDS only in V1. Future bridges may come but are not required for the solo-developer use case.
- **Hard token-budget enforcement.** Only soft signals (`ps` elapsed time, `doctor` subprocess-count warnings). Hard caps require provider integration outside this scope.
- **Time-travel features (fork, diff, branch).** Deferred to V2; V1 must shape the event log to support them but does not implement the commands.
- **Cross-host run portability.** Run directories are tied to the workstation they were created on; copying them to another machine is not supported.
- **Workflow editing / template marketplace.** The runner consumes user-written workflow JSON files; authoring tools are out of scope.

## Phased Rollout Plan

### MVP (Phase 1)
- F1: Background daemon with auto-spawn and manual `daemon` foreground mode.
- F2: `start`, `attach`, `detach`, with auto-attach default and TTY detection.
- F3: Short id + slug identifiers with prefix matching.
- F4: `ps` with default columns and `doctor` with basic checks.
- F5: `retry-step` with explicit "may differ" banner.
- F7: Daemon-restart run discovery (marks as `crashed`, no auto-resume).
- F10: Per-run event log with rotation, filtered to exclude `thought` streams.

**Success criteria to proceed to Phase 2:**
- All seven KPIs in `Success Metrics` met on the project author's daily workflow over a 2-week dogfooding period.
- Zero data loss across a deliberate `kill -9` of the daemon mid-run, followed by daemon restart and `retry-step`.
- Author successfully runs ≥3 concurrent workflows in a normal working session.

### Phase 2
- F6: Headless `send` for queuing messages to interactive steps.
- F8: Multi-attach (broadcast) with single-writer input slot and visible writer indicator.
- F9: `stop` with graceful-then-forceful semantics.

**Success criteria to proceed to Phase 3:**
- Author uses `send` at least once per week unprompted (signal that the headless flow is useful, not a feature looking for a problem).
- Multi-attach used at least once in a pair-programming or screensharing context without input collisions.

### Phase 3 (V2 stretch — out of scope for this PRD, but the foundation must support it)
- Time-Travel Workflows: `workflow-runner fork <run-id> --at step-N` to branch a run; `workflow-runner diff <run-a> <run-b>` to compare event logs.
- `--auto-retry` flag for opt-in silent recovery of crashed autonomous runs.
- Slack/email/desktop notification on terminal-state transitions.

## Success Metrics

| Metric | Target | How to measure |
|---|---|---|
| Workflow survival rate across SIGHUP / terminal close / OS sleep | ≥ 99% | Integration test: start a workflow, kill the TUI parent, assert the run progresses to completion in the daemon log. |
| Median `retry-step` latency (crash → first banner) | < 30 seconds | Synthetic test: `kill -9` daemon during a step, restart, `retry-step`, time-to-first-banner. |
| Max concurrent runs without observable degradation | ≥ 4 | Manual load test: start 4 representative workflows; assert all progress; daemon CPU < 50% on a 4-core machine. |
| TUI attach latency (cmd → first paint) | < 1 second incl. backlog replay | Time from `attach` invocation to first rendered event against a run with ~1 MB step backlog. |
| Per-run on-disk size after 1 hour | < 50 MB | Run a representative workflow for 1 hour; measure `events.jsonl` size. |
| Time-to-first-workflow on fresh install | < 2 minutes | Cold-install dry-run: install → `start workflow.json` → first banner, no manual daemon-start step. |
| Author dogfooding adoption (Phase 1 gate) | 100% of personal workflows run via daemon mode for 2 weeks | Self-reported usage check at end of dogfooding period. |

## Risks and Mitigations

- **Risk:** Users (the author) treat `retry-step` as continuation despite the banner, then get confused when the agent doesn't pick up where it left off. **Mitigation:** The banner appears in both CLI output and TUI on attach, includes the word "fresh" explicitly, and `--help` for `retry-step` leads with the non-determinism caveat.
- **Risk:** Auto-spawn surprises users in non-TTY environments (CI, pipes). **Mitigation:** Detect non-TTY stdout in `start` and silently behave as `--detach`, printing the run-id; document this in `--help`.
- **Risk:** The author dogfoods daemon mode in week 1, hits a bug, falls back to running workflows from `bun src/index.ts` indefinitely. **Mitigation:** Remove the foreground entry path entirely as part of Phase 1 shipping; there is no fallback to fall back to. This is acceptable because there are no external users.
- **Risk:** Disk usage grows unboundedly across many short runs (lots of run directories accumulating). **Mitigation:** Phase 1 ships per-run log rotation only; an automatic GC of terminal-state runs older than N days is tracked as a Phase 3 task and surfaces in `doctor` as a WARN once total disk usage crosses a threshold.
- **Risk:** Multi-attach writer-slot semantics produce confusing UX when used. **Mitigation:** Defer multi-attach to Phase 2 and gate ship on at least one observed real pair-programming session without input collisions.
- **Risk:** The CLI grows past what one mental model can carry as features accumulate. **Mitigation:** Every new subcommand must justify itself against the multiplexer mental model (ADR-002); deviations require a new ADR explaining why.

## Architecture Decision Records

- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — Council-debated V1 cut: parallel runs, attach/detach, CLI message queue, `retry-step`, daemon-restart discovery; defers conversation persistence and auto-retry to V2.
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — Adopts a tmux/abduco-shaped UX over pm2-style supervisor or two-mode CLI; locks in the user-facing shape that subsequent design choices must respect.

## Open Questions

- **Writer-slot promotion policy on multi-attach.** When the writer TUI detaches, should the next-attached TUI auto-promote (current draft) or should there be no writer at all until someone explicitly claims it via a `/claim` slash command? Trade-off: convenience vs predictability. To be resolved during Phase 2 design.
- **`doctor` thresholds.** What active-subprocess count triggers a WARN? What disk usage threshold triggers a WARN? Reasonable defaults need to be chosen during MVP implementation based on the author's typical machine.
- **Terminal-state run retention window.** "~24 hours" is the placeholder; exact value (and whether configurable) to be tuned after a week of dogfooding.
- **Slug vocabulary collisions.** With a finite adjective-animal vocabulary, collision probability across a long-lived daemon is non-trivial; do we re-use slugs after a terminal-state run is GC'd, or never? Affects script ergonomics. Defer to techspec.
- **Daemon log location and rotation.** The daemon's own log (separate from per-run event logs) needs a location, rotation policy, and verbosity controls. The PRD assumes its existence (for the "completion signal" question answered earlier); exact behavior is techspec.
- **`stop --force` flag.** The current draft has no `--force` because graceful-then-forceful is built into `stop`. Is there a use case (genuinely stuck agent that doesn't respond to SIGTERM within the grace window and where the user wants an immediate SIGKILL without waiting)? Defer until we hit it.
