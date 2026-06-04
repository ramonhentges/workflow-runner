# PRD: Multiple IDE Support (Per-Step Agent Selection)

## Overview

Workflow Runner orchestrates multi-step agent workflows, but every step runs on a
single coding agent: opencode. Authors who want a different agent for a given step —
to use a stronger reasoning model for planning, a cheaper agent for routine edits, or
an agent they already trust for a specific domain — have no way to express that.

This feature lets each workflow step declare which coding agent ("IDE") it runs on.
The runner reads that choice and drives the matching agent through the same
orchestration loop. The first release supports **opencode, Claude Code, Codex CLI,
and Gemini CLI**, each at full parity, and a single workflow may mix them freely,
including handing off from a step on one agent to a step on another.

- **Problem**: Workflows are locked to one agent; authors can't route steps to the
  best-fit agent and can't combine agents' strengths in one workflow.
- **Who it's for**: Workflow authors who compose multi-step agent workflows, and
  operators who run them.
- **Why it's valuable**: Each step runs on the agent best suited to it — by
  capability, model access, or cost — without splitting work across separate tools or
  losing the handoff/finish orchestration that ties a workflow together.

## Goals

- Let every step choose its agent from {opencode, Claude Code, Codex CLI, Gemini CLI}
  and have the run honor that choice.
- Support all four agents at full parity: persona/agent selection, model selection,
  interactive and autonomous modes, and handoff/finish.
- Allow a single workflow to mix agents across steps, including cross-agent handoffs,
  with no change to how authors write handoff intent.
- Keep existing single-agent workflows working with a one-time, low-cost edit.
- Give authors a clear, immediate error when a step's agent is unavailable, naming the
  step and the agent.

## User Stories

**Primary persona — Workflow author**
- As a workflow author, I want to set the agent on each step so that planning,
  implementation, and review steps each run on the agent I judge best.
- As a workflow author, I want a step on one agent to hand off to a step on a
  different agent so that I can combine agents in one workflow.
- As a workflow author, I want to pick the persona/agent and model on any supported
  agent so that a step behaves the same way regardless of which agent backs it.
- As a workflow author, I want to be told exactly which step and agent caused a
  failure so that I can fix my workflow quickly.

**Secondary persona — Operator (runs workflows)**
- As an operator, I want a run to fail clearly at the step whose agent isn't installed
  or authenticated so that earlier completed work is preserved and the cause is obvious.
- As an operator, I want existing workflows to keep running after this change so that
  upgrading doesn't break what I already have.

## Core Features

**1. Per-step agent selection (must-have)**
- Each step declares its agent via the `ide` field. The runner reads it and runs the
  step on that agent. `ide` is **required** on every step.
- Behavior is consistent across agents: the same step concepts (persona/agent, model,
  mode, description, edges) apply everywhere.

**2. Four supported agents at full parity (must-have)**
- opencode, Claude Code, Codex CLI, and Gemini CLI are all selectable.
- On each, the step can select a persona/agent, select a model, run in interactive or
  autonomous mode, and resolve via handoff or finish.

**3. Mixed-agent workflows with cross-agent handoffs (must-have)**
- A workflow may use different agents on different steps. A handoff from a step on one
  agent to a step on another works the same as a same-agent handoff; authors write
  handoff intent exactly as today.

**4. Clear failure when an agent is unavailable (must-have)**
- If a step names an agent that isn't installed/authenticated, or an unrecognized
  agent value, the run fails when execution reaches that step, with a message naming
  the step and the agent. Steps that already completed keep their results.

**Feature interaction**: Agent selection sits underneath the existing orchestration —
banners, status, interactive input, handoff/finish, retry-step, and the TUI/event log
behave identically regardless of which agent a step uses.

## User Experience

**Authoring a workflow**
1. The author writes the workflow JSON and sets `ide` on each step to one of the four
   supported agents, alongside the existing `agent`, `model`, `mode`, and `edges`.
2. The author defines handoff edges between steps as today, regardless of whether the
   next step uses a different agent.

**Running a workflow**
1. The operator starts the run as today (`workflow-runner start ...`).
2. Each step launches on its declared agent; the TUI/log shows the same banners,
   streamed output, and status for every agent.
3. On reaching a step whose agent is unavailable or unrecognized, the run halts at
   that step with a clear, named error; prior steps' work is preserved and the run can
   be retried after the environment is fixed.

**Discoverability & onboarding**
- The set of supported agent values and the requirement that `ide` be explicit are
  documented in the workflow JSON format reference and the example workflow.
- Existing workflows already set `ide`, so adopting the requirement is a no-op edit for
  them.

## High-Level Technical Constraints

- Each supported agent must be reachable over the Agent Client Protocol; this depends
  on the agent's CLI and ACP bridge being installed and authenticated in the run
  environment. These are operator prerequisites, not something the product installs.
- The handoff/finish orchestration contract is agent-agnostic and must remain
  unchanged, so workflows behave identically across agents.

## Non-Goals (Out of Scope)

- Agents beyond the four named (e.g., GitHub Copilot, Qwen Code, Cursor). Adding more
  is a future increment.
- Auto-installing, auto-authenticating, or version-managing the underlying agent CLIs.
- A picker/UI for choosing an agent; selection is declared in the workflow JSON.
- Per-workflow or per-run global agent override; selection is strictly per step.
- Translating or normalizing persona/model names across agents (e.g., mapping a
  Claude model name to a Gemini equivalent). Authors specify values valid for the
  step's chosen agent.
- Load-time validation of `ide` values against the supported set; validation happens
  when execution reaches the step.

## Phased Rollout Plan

### MVP (Phase 1)
- `ide` required on every step; runner routes each step to its declared agent.
- opencode, Claude Code, Codex CLI, and Gemini CLI supported at full parity.
- Mixed-agent workflows with cross-agent handoffs.
- Fail-at-the-step error when an agent is unavailable/unrecognized, naming step + agent.
- Docs and example workflow updated.
- **Success criteria to proceed**: A single workflow that uses all four agents across
  its steps runs end to end, including at least one cross-agent handoff; an
  unavailable-agent step fails with a clear named error while earlier steps' work
  persists.

### Phase 2
- Add further ACP-compatible agents (e.g., Copilot, Qwen Code) using the same
  per-step model, driven by author demand.
- **Success criteria**: New agents added without changes to the orchestration loop or
  handoff/finish contract.

### Phase 3
- Author-experience improvements such as validation tooling that flags unsupported or
  unavailable agents before a run, if demand warrants.

## Success Metrics

- A workflow exercising all four agents completes end to end in manual E2E testing,
  including a cross-agent handoff.
- 100% of existing example/fixture workflows continue to run after the change.
- Unavailable/unrecognized-agent failures are reported at the correct step, naming the
  step and agent, in 100% of cases.
- No regression in same-agent (opencode) workflow behavior versus today.

## Risks and Mitigations

- **Author confusion about which persona/model values are valid per agent**
  (adoption risk). Mitigation: document supported agents and field expectations in the
  workflow format reference and example; clear step-level errors guide correction.
- **Underlying agent CLIs not installed/authenticated in the run environment**
  (dependency risk). Mitigation: fail-at-the-step with a named error; document
  prerequisites per agent.
- **Differing capabilities across agents threaten the full-parity promise**
  (dependency risk). Mitigation: parity is validated per agent in E2E; any field an
  agent genuinely cannot honor surfaces as a clear error rather than silent divergence.
- **Competitive landscape** (cc-switch, Conductor, myclaude offer multi-agent routing).
  Mitigation: differentiate on workflow-native, per-step orchestration with structured
  handoff/finish rather than ad-hoc switching.

## Architecture Decision Records

- [ADR-001: Per-step IDE selection with unified full-parity step schema](adrs/adr-001.md)
  — Each step declares a required `ide`; the runner routes to one of four supported
  agents at full parity behind the existing session-factory boundary, with mixed-agent
  workflows and fail-at-the-step validation.

## Open Questions

- Should the supported-agent set be surfaced anywhere at runtime (e.g., in `doctor`),
  or is documentation sufficient for the MVP?
- For Codex CLI and Gemini CLI, are there persona/model selection concepts that don't
  map cleanly to the step's `agent`/`model` fields, and if so how should authors
  express them? (To confirm during TechSpec.)
