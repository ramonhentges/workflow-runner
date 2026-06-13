# PRD: Initial Prompt at Run Start

## Overview

Today, starting a workflow run gives the user no way to say *what this particular
run is about*. The first step's agent receives only the workflow's static
`description`, so every run of a workflow begins identically. A user who wants to
point a run at a specific task — "investigate the failing login test", "review
PR #42", "draft release notes for v2.1" — must edit the workflow file or work
around it after the agent starts.

This feature adds an **optional initial prompt**: a free-text message the user can
supply when starting a run. The prompt is handed to the first step's agent as the
user's request for that run, on top of the step's existing description. It is
available from all three places a run can be started — the CLI `start` command,
the web Start Run form, and the web workflow-list run dialog — and the prompt a
run was launched with is shown afterward in the run view.

It is for anyone who runs workflows: developers driving an agent at a concrete
task, and reviewers who later want to recall what a run was asked to do. It is
valuable because it turns a static, one-shape-per-workflow run into a directed
one without forcing the user to edit workflow definitions.

## Goals

- Let a user start any workflow with an optional, per-run task message from all
  three start surfaces (CLI, Start Run form, workflow-list run dialog).
- Deliver the agent the prompt with framing that clearly marks it as the user's
  request for this run, distinct from inter-step handoff context.
- Preserve today's behavior exactly when no prompt is given.
- Make the prompt a run was started with visible in the run view after the fact.
- Ship all three surfaces together in a single, consistent release.

## User Stories

**Primary persona — the operator (developer running a workflow)**

- As an operator, I want to type a task message when I start a run from the web,
  so the first agent works on what I actually need this time.
- As an operator on the terminal, I want to pass a prompt to `start` inline for
  short tasks and from a file or stdin for longer ones, so I am not limited to a
  single line.
- As an operator, I want to start a run with no prompt and have it behave exactly
  as it does today, so the field never gets in my way for self-contained
  workflows.
- As an operator starting a run from the workflow list, I want the same prompt
  option in the run dialog I already use for the branch, so I do not have to
  switch screens.

**Secondary persona — the reviewer**

- As a reviewer opening a run later, I want to see the prompt it was started with,
  so I understand what the run was asked to do without reconstructing it.

## Core Features

### 1. Optional initial prompt on all three start surfaces

What it does: adds an optional free-text prompt to every way a run is started.
Why it matters: the user's stated need is to direct a run from the CLI, the Start
Run form, and the workflow-list start action. High-level behavior:

- **CLI `start`**: a prompt flag accepts inline text for short prompts and reads
  from a file or stdin for longer ones (mirroring the existing `send <run-id> -`
  convention). Omitting the flag starts the run with no prompt.
- **Web Start Run form**: an optional multi-line prompt field, presented like the
  existing branch field — clear label, helper text, blank by default.
- **Web workflow-list run dialog**: the same optional multi-line prompt field in
  the dialog the user already uses to choose a branch and start the run.

A blank or omitted prompt is indistinguishable from today's behavior.

### 2. User-request framing for the first step

What it does: delivers the prompt to the first step's agent under a label that
identifies it as the user's request for this run. Why it matters: the kickoff
currently frames inbound context as "Context from previous step", which would
mislead an agent into treating a user prompt as prior-step output. High-level
behavior: the prompt is appended to the first step's kickoff under distinct
"user request for this run" framing; only the entry step is affected — later
steps continue to receive handoff messages as today.

### 3. Run-view visibility of the launch prompt

What it does: records the prompt with the run and shows it in the run view (web
and TUI transcript). Why it matters: reviewers and operators need to recall what
a run was asked to do. High-level behavior: the prompt is stored as run metadata
and surfaced in the run view. It is intentionally kept out of the compact `ps`
listing to keep that view scannable.

### Feature interaction

Features 1–3 form one path: a prompt entered on any surface (1) is framed for the
first step (2) and recorded for later viewing (3). The prompt is independent of
the existing branch/worktree option — they can be used together or separately.

## User Experience

**Operator, web (Start Run form or workflow list):** the user picks a workflow,
optionally sets a branch as today, and now optionally types a task into a prompt
field. They start the run and are taken to the run view, where the prompt they
entered is visible alongside the run's progress.

**Operator, CLI:** the user runs `start <workflow>` with a prompt flag —
inline text for a quick task, or pointing at a file / piping via stdin for a
longer brief. With no flag, the command behaves as it does today.

**Reviewer, web:** opening any run, the reviewer sees the prompt the run was
started with (or a clear indication there was none) without digging through logs.

UX considerations:

- The prompt field is optional everywhere and visually consistent with the
  established branch field (label, helper text, blank default placeholder).
- Multi-line entry is supported in the web surfaces; long prompts are supported on
  the CLI via file/stdin.
- The run view presents the prompt as run context, not as agent output.

## High-Level Technical Constraints

- Must preserve the existing start contract for callers that supply no prompt —
  the no-prompt path stays behavior-identical to today.
- Must reuse the established pattern for threading an optional start field across
  CLI, web, and the start contract (as the branch field does).
- The first step's agent must receive the prompt with framing distinct from
  inter-step handoff context.

(Specific field names, contract shapes, and storage mechanisms are deferred to the
TechSpec.)

## Non-Goals (Out of Scope)

- Structured or multi-variable inputs (key/value variables referenced across
  steps). The prompt is a single free-text message.
- Overriding or replacing the first step's description. The prompt supplements it.
- Making the prompt required, or letting a workflow author mark it required. It is
  always optional in this release.
- Targeting any step other than the first with the initial prompt.
- Showing the prompt in the compact `ps` listing.
- Prompt templates, history, saved/favorite prompts, or re-run-with-same-prompt.
- Editing the prompt of an already-started run.

## Phased Rollout Plan

### MVP (Phase 1)

- Optional prompt on all three start surfaces (CLI inline + file/stdin, Start Run
  form, workflow-list run dialog).
- User-request framing for the first step.
- Prompt persisted with the run and shown in the run view (web + TUI transcript).
- No-prompt path is behavior-identical to today.

Success criteria to proceed: a run can be started with a prompt from each of the
three surfaces; the first agent acts on the prompt; the prompt is visible in the
run view; runs started without a prompt are unchanged.

### Phase 2 (deferred, only if demand emerges)

- Saved/recent prompts or re-run-with-same-prompt convenience.

### Phase 3 (deferred, only if demand emerges)

- Structured multi-variable inputs and/or author-defined required prompts with
  labels, helper text, and defaults.

## Success Metrics

- All three start surfaces accept an optional prompt and a run can be started from
  each with and without one.
- Runs started without a prompt remain byte-for-byte equivalent to today's
  behavior (no regression).
- For a run started with a prompt, the first step's agent acts on the prompt
  rather than only the static description.
- The launch prompt is visible in the run view for runs that had one.
- Adoption signal: a meaningful share of runs are started with a prompt within a
  few weeks of release (indicating the capability meets a real need).

## Risks and Mitigations

- **Users do not discover the field.** Mitigation: present it consistently with
  the familiar branch field on every surface and document the CLI flag in usage
  help.
- **The prompt is mistaken by the agent for prior-step output.** Mitigation:
  distinct "user request for this run" framing, separate from handoff wording.
- **Scope creep toward structured variables.** Mitigation: Non-Goals explicitly
  defer variables; the MVP is a single free-text message.
- **Sensitive content in prompts shown in the run view.** Mitigation: treat the
  prompt as ordinary run metadata, keep it out of compact listings, and surface
  it only in the run's own view.

## Architecture Decision Records

- [ADR-001: Unified optional initial prompt across all run-start surfaces](adrs/adr-001.md)
  — Deliver one optional free-text prompt across CLI and both web surfaces in a
  single release, persisted and shown in the run view, rejecting phased and
  no-visibility alternatives.

## Open Questions

- Should there be a maximum prompt length on any surface, or is it unbounded
  free text?
- When a run is started with no prompt, should the run view show an explicit
  "no initial prompt" indicator, or simply omit the section?
