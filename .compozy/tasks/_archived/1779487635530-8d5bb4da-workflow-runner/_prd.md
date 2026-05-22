# PRD: Workflow Runner

## Overview

The Workflow Runner is a terminal application that executes a multi-step agent workflow defined in a JSON config file (such as `workflows/who-is.json`). A workflow is a directed graph of steps; each step binds a specific agent persona, model, and execution mode, and declares outgoing edges that describe — in natural language — when to route to a given next step.

**Problem it solves.** Today `src/index.ts` can only run a single agent in a single session. There is no way to chain specialized agents, switch personas mid-run, or let a workflow decide its own path. Authoring multi-agent processes is impossible without a runner that understands steps and edges.

**Who it is for.** Workflow authors — developers who design multi-agent processes and need to run, observe, and iterate on them from the terminal.

**Why it is valuable.** It turns a static workflow config into a live, observable execution: the user watches each agent think and act, converses with interactive steps, and lets the workflow route itself through autonomous steps — all in one continuous terminal session.

## Goals

- Execute any valid workflow config end-to-end, advancing step by step until an agent finishes the workflow.
- Support both execution modes per step: **interactive** (two-way conversation between user and agent) and **autonomous** (agent works independently while streaming its thinking and data).
- Give each step its own fresh connection and session, bound to that step's agent, model, and mode.
- Let the running agent control the workflow's path through two MCP tools: one to hand off to a next step, one to finish the workflow.
- Keep every run observable: clear step boundaries, live streaming, and an end-of-run summary.
- **Milestone:** `workflows/who-is.json` runs cleanly through both an interactive step and an autonomous step in the MVP.

## User Stories

**Primary persona — Workflow Author**

- As a workflow author, I want to launch a workflow by passing its config file path, so that I can run a process I designed without extra setup.
- As a workflow author, I want to start a run from a specific step, so that I can test a mid-workflow step without replaying everything before it.
- As a workflow author, I want each step to run as its declared agent and model, so that the right specialist handles each part of the process.
- As a workflow author, I want to converse with interactive steps, so that I can steer the workflow with my intent.
- As a workflow author, I want autonomous steps to stream their thinking and data, so that I can see what the agent is doing without having to chat.
- As a workflow author, I want a clear banner whenever a new step begins, so that I can tell which agent is currently active.
- As a workflow author, I want a summary when the workflow finishes, so that I can review what happened and scroll back through the run.
- As a workflow author, I want a clear error when a step fails, so that I can fix my workflow config or agent setup.

**Secondary flows / edge cases**

- As a workflow author, when an autonomous step has multiple edges, I want the agent to choose the next step from its own work, so that the workflow self-routes.
- As a workflow author, when a step's agent picks an invalid next step or never hands off, I want the run to halt with a clear explanation rather than hang.

## Core Features

**1. Workflow launch (P0)**
Load and validate a workflow config from a file path passed on the command line. An optional flag starts the run from a chosen step instead of the entry step. Invalid or missing configs are rejected before any agent starts, with a clear message.

**2. Per-step session lifecycle (P0)**
For each step, spawn a fresh connection and session bound to that step's `agent`, `model`, and `mode`. The session is torn down when the step hands off or finishes. No session state leaks between steps.

**3. Interactive step experience (P0)**
When a step's mode is `interactive`, the runner shows the input field. The user and agent converse freely. The agent routes to the next step by matching the user's expressed intent against the step's edge `intent` descriptions.

**4. Autonomous step experience (P0)**
When a step's mode is `autonomous`, the runner hides the input field and streams the agent's thinking and tool activity live. The agent performs the step's work, then chooses the next step itself by matching its own work against the edge `intent` descriptions.

**5. Handoff tool (P0)**
An MCP tool available to every step. The agent calls it to select the next step from the current step's declared edges and to pass a short handoff message. The runner validates the chosen step is a declared edge target, ends the current session, and starts the next step with that message as its opening context.

**6. Finish tool (P0)**
An MCP tool available to every step. The agent calls it to end the workflow and provide a closing message. Used when a step has no outgoing edges or the workflow's purpose is complete.

**7. Step banners and continuous log (P0)**
A single scrollable log spans the whole run. Each step begins with a banner naming the step id, agent, model, and mode, so step boundaries are always visible.

**8. End-of-run summary (P0)**
When the workflow finishes, the runner shows a summary — steps visited in order, the agent's finish message, and total run duration — and keeps the TUI open so the user can scroll back through the full history before quitting.

**9. Halt-and-report failure handling (P0)**
On any failure — a step's agent crashing, a handoff to a step that is not a declared edge target, or a step that ends without calling handoff or finish — the runner stops the workflow, shows which step failed and why, keeps the TUI open for inspection, and exits with a failure status.

**Feature interaction.** Handoff (5) and finish (6) are the only ways a step ends normally; the step lifecycle (2) reacts to them by tearing down and advancing. Banners (7) mark every transition driven by (5). The summary (8) is produced by (6); the failure path (9) replaces it when a run cannot complete.

## User Experience

**Persona & goal.** The workflow author wants to run a workflow they designed and watch it behave, switching between conversing with the process and watching it work.

**Primary flow — a full run**

1. The author runs the runner with a workflow file path (optionally with a start-step flag).
2. The runner validates the config and shows the entry step's banner.
3. **Interactive step:** the input field appears; the author chats with the agent; the agent does the step's work and, guided by the author's intent, calls the handoff tool to pick the next step.
4. A new banner appears; the runner spawns a fresh session for the next step bound to its agent/model/mode; the handoff message is the next agent's opening context.
5. **Autonomous step:** the input field disappears; the agent's thinking and tool data stream into the log; the agent finishes the step's work and calls handoff (choosing from edges) or finish.
6. On finish, the runner shows the end-of-run summary and leaves the TUI open; the author scrolls back, then quits.

**UX considerations**

- Mode is unmistakable: interactive steps show an input field, autonomous steps do not.
- Step banners give continuous orientation — the author always knows which agent is active.
- Autonomous steps still render thinking and tool activity, so "autonomous" never means "opaque."
- A visible "starting step…" status covers the wait while a fresh session spawns, so per-step startup latency is legible rather than confusing.
- Failures are explicit and inspectable: the run halts, the cause is named, and the log stays on screen.

## High-Level Technical Constraints

- The runner integrates with the Agent Client Protocol (ACP) and the existing `opencode` agent process, consistent with `src/index.ts`.
- The handoff and finish capabilities are delivered as MCP tools made available to each step's session.
- Each step requires a fresh connection and session; sessions are not reused across steps.
- Workflows are defined by the existing JSON config shape (`steps` with `id`, `agent`, `description`, `mode`, `ide`, `model`, `edges`).
- The runner is a terminal application; no graphical UI.

*(No databases, frameworks, or architecture patterns are prescribed here — those belong in the TechSpec.)*

## Non-Goals (Out of Scope)

- A graphical or multi-pane graph view of the workflow (live node/edge diagram).
- A workflow picker or directory browser — the MVP takes one explicit file path.
- Interactive failure recovery (retry / skip / resume) — the MVP halts and reports.
- Authoring or editing workflow configs inside the runner.
- Parallel or fan-out step execution; the MVP runs exactly one step at a time.
- Carrying full transcripts or rich state between steps — only a short handoff message is passed.
- Persisting run history to disk, run replay, or analytics.
- Cross-step shared memory or a global workflow data store.

## Phased Rollout Plan

### MVP (Phase 1)

- Core features 1–9: launch by file path with start-step override, per-step sessions, both modes, handoff and finish MCP tools, step banners, end-of-run summary, halt-and-report failure handling.
- **Success criteria to proceed to Phase 2:** `workflows/who-is.json` runs end-to-end — interactive entry step routes via user intent, the chosen autonomous step completes its work and finishes — with correct agent/model/mode binding and a clean summary. Invalid configs and the three failure cases halt with clear messages.

### Phase 2

- Workflow picker that scans a workflows directory.
- Interactive failure recovery: retry the failed step, skip to a chosen step, or abort.
- Richer end-of-run summary (per-step duration, exportable run log).

### Phase 3

- Live graph view of the workflow with the current step highlighted.
- Optional session/process pooling to reduce per-step startup latency.
- Branching beyond single-next routing and richer cross-step context passing.

## Success Metrics

- **Completion:** a valid workflow runs from entry step to a `finish` call without manual intervention beyond interactive-step conversation.
- **Mode correctness:** 100% of interactive steps show the input field and 100% of autonomous steps hide it, across a run.
- **Binding correctness:** every step runs as the agent, model, and mode declared in its config.
- **Routing correctness:** every handoff resolves to a declared edge target; invalid targets are rejected, not followed.
- **Observability:** every step transition produces a banner; every autonomous step streams thinking/tool data.
- **Failure clarity:** each of the three failure cases halts the run and names the failing step and cause.
- **Time-to-first-run:** a workflow author can launch a workflow with a single command and no config beyond the workflow file.

## Risks and Mitigations

- **Adoption — config authoring friction.** If writing a workflow JSON is error-prone, authors won't use the runner. *Mitigation:* validate configs up front with specific, actionable error messages; ship `who-is.json` as a working reference.
- **Usability — per-step startup latency.** Spawning a fresh session per step adds a visible pause between steps. *Mitigation:* a clear "starting step…" status; session pooling deferred to Phase 3 if the pause proves painful.
- **Usability — long single-pane log.** Big workflows produce a long log. *Mitigation:* step banners plus scrollback for the MVP; graph view considered in Phase 3.
- **Correctness — agent fails to route.** An agent may pick an invalid edge or never call handoff/finish. *Mitigation:* halt-and-report covers all three cases explicitly; clear edge `intent` descriptions in example configs reduce occurrence.
- **Scope creep.** Graph views and recovery flows are tempting. *Mitigation:* Non-Goals and the phased plan keep the MVP minimal.

## Architecture Decision Records

- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — Build the runner as one persistent TUI that advances step by step, spawning a fresh agent/model/mode-bound session per step; rejected a headless console runner and a full workflow IDE.

## Open Questions

- **Entry step.** The current config has no explicit entry-step field. The MVP assumes the first step in the list is the entry step. Should the config gain an explicit `entry` field?
- **Handoff message authorship.** Is the handoff message always agent-authored, or should interactive steps let the user contribute to it?
- **`ide` field.** Each step declares an `ide` (e.g. `opencode`). For the MVP, is `opencode` the only supported value, or must the runner honor other values?
- **Edge-less non-terminal steps.** If a step has no edges but the agent does not call finish, this is treated as a failure. Should an edge-less step instead auto-finish?
- **Model availability.** If a step names a model that is unavailable, should this be caught at config validation (before the run) or only when that step starts?
