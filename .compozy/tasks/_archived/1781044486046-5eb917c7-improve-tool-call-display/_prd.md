# PRD: Improved Tool-Call Display (CLI + Web)

## Overview

When a workflow run executes, the driving agent invokes tools — running shell
commands, reading files, editing files. Today the user watches each of these
as a stream of disconnected, cryptic log lines:

```
Tool: bash (pending)
Tool: call_00_KnfQZhfHqu3t3jhqtYtm2315: in_progress
Tool: call_00_KnfQZhfHqu3t3jhqtYtm2315: completed
```

This is noisy, hard to scan, and hides what actually happened: the user can't
tell which command ran, which file was touched, whether a step is still
working or finished, or why something failed. The opaque id leaks into the UI
while the useful detail is thrown away.

This feature replaces that noise with **one clean, self-updating entry per
tool call** in both the CLI/TUI and the web UI. Each entry shows a status
icon (or spinner while running), a human-readable summary of the action, and —
when a call fails — a short reason. The same experience holds whether the user
watches live, re-attaches to a running run, or reopens a finished one.

**Who it is for:** anyone running or observing a workflow — the operator
driving an interactive run, and anyone reviewing what an autonomous run did.

**Why it is valuable:** the tool-call log is the primary window into what the
agent is doing. Making it legible turns a wall of noise into a trustworthy,
glanceable activity feed, reducing confusion and the time spent figuring out
run state.

## Goals

- Replace multi-line, id-leaking tool-call logs with a single self-updating
  entry per call in both the CLI and the web UI.
- Communicate status at a glance: pending, running (animated), completed,
  failed.
- Show what each call did in human terms (the command for shell calls, the
  file for read/edit calls), not an internal id.
- Surface a short failure reason when a call fails.
- Achieve identical rendering across live viewing, re-attach, and reopening a
  finished run.
- Reach CLI/web parity in the same release — neither surface lags behind.

## User Stories

**Primary persona — Operator (drives an interactive run from the CLI):**

- As an operator, I want each tool call to appear as one line that updates in
  place, so my terminal isn't flooded with three lines per action.
- As an operator, I want a spinner while a call runs and a clear ✓/✗ when it
  finishes, so I know at a glance whether the agent is still working.
- As an operator, I want to see the actual `bash` command or the file being
  read/edited, so I understand what the agent is doing without guessing.
- As an operator, when a call fails I want a short reason on the line, so I can
  react without digging through raw output.

**Primary persona — Reviewer (watches a run, often in the web UI):**

- As a reviewer, I want the web transcript to show a tidy list of tool calls
  with icons and summaries, so I can skim the run's activity.
- As a reviewer, when I reopen a finished run, I want every tool call shown in
  its final ✓/✗ state, so the history matches what a live viewer saw.

**Secondary flows / edge cases:**

- As a user re-attaching to a still-running run, I want in-flight calls to
  resume showing their live status (spinner) and past calls to show their final
  state.
- As a user, I want a call that completes almost instantly to settle cleanly to
  its final icon without a distracting flash of spinner.

## Core Features

### 1. Per-call entry with stable identity

Each tool call is one entry, keyed by its stable id. All lifecycle updates for
that call mutate the same entry rather than appending new lines. This is the
foundation that the rest of the experience builds on.

### 2. Status affordance (icon + spinner)

Each entry shows its status visually:

- **Pending** — a neutral/pending icon.
- **Running** — an animated spinner. To avoid flicker, very fast calls settle
  directly to their final icon rather than flashing a spinner.
- **Completed** — a success icon (✓).
- **Failed** — a failure icon (✗).

### 3. Human-readable action summary

Instead of an internal id, each entry shows what the agent did:

- Shell calls show the command (e.g. `Bash: npm test`).
- File reads show the file (e.g. `Read src/domain/runner.ts`).
- File edits show the file (e.g. `Edit web/App.tsx`).
- When specific detail isn't provided by the agent, fall back to the action's
  title/kind so the entry is still meaningful.

File paths are shown in a readable, relative form where possible.

### 4. Inline failure reason

Successful calls stay as a clean summary line (no output, no diffs). A failed
call is the deliberate exception: it appends a short error reason to its entry
(e.g. `✗ Edit web/App.tsx — file not found`), because failure is the case where
the user most needs context.

### 5. Persistent history & faithful replay

Tool-call entries are part of the run's durable history. Re-attaching to a
running run, or reopening a finished run, reconstructs every call in its
correct final state — visually identical to having watched it live.

### 6. Parity across CLI and web

Both surfaces consume the same underlying tool-call model and present the same
information and lifecycle. Visual styling is native to each surface (terminal
glyphs vs. web components), but the content and behaviour match.

## User Experience

**Live run, CLI:**

1. The agent invokes `bash` to run tests. A single entry appears:
   `⏺ Bash: npm test` with a spinner.
2. As the call runs, the spinner animates in place — no new lines.
3. On success the entry settles to `✓ Bash: npm test` and stays in scrollback.
4. The next call (`Read src/domain/runner.ts`) appears as its own entry below,
   following the same lifecycle.
5. A failing edit settles to `✗ Edit web/App.tsx — file not found`.

**Live run, web:**

- The transcript renders the same sequence as a list of tidy rows, each with an
  icon/spinner, the summary, and (on failure) the reason — styled with the
  app's existing component look.

**Re-attach / reopen:**

- Opening a finished run shows the full list of tool calls already in their
  ✓/✗ states. Re-attaching mid-run shows resolved calls in final state and any
  in-flight call still animating.

**UX considerations:**

- Spinner appears only for calls that run long enough to warrant it, avoiding
  visual flashing on fast operations.
- Entries remain in chronological order interleaved with the agent's other
  output (messages, status), preserving the run narrative.
- Long commands/paths are presented so they remain scannable (e.g. sensible
  truncation) without losing the essential identity of the action.

## High-Level Technical Constraints

- Must work across all supported IDEs (`opencode`, `claude-code`, `codex`,
  `gemini`); summary richness may vary by IDE, so the experience must degrade
  gracefully to a title/kind fallback when details are sparse.
- Must integrate with the existing run event history so that durability and
  replay come "for free" and behave consistently with other run output.
- Performance: in-place updates must not degrade TUI responsiveness or web
  rendering for runs with many tool calls.
- Backward compatibility: runs recorded before this feature will render with
  legacy log lines; no migration of old history is required.

## Non-Goals (Out of Scope)

- **Expandable detail panels** — showing full command output, file diffs, or
  raw tool input/output is explicitly deferred. Only summary lines (plus
  failure reasons) are in scope.
- **Result snippets on success** — no exit codes, line-change counts, or output
  previews for successful calls.
- **Collapsing/auto-hiding** completed calls — every call stays as static
  history.
- **Per-tool-kind theming beyond a basic icon/summary** — no rich, tool-
  specific widgets.
- **Migrating or rewriting historical runs** recorded before this feature.
- **Filtering, searching, or grouping** the tool-call feed.

## Phased Rollout Plan

### MVP (Phase 1)

- First-class, id-keyed tool-call entries persisted in run history.
- Status affordance: pending icon, running spinner (with fast-call settling),
  completed ✓, failed ✗.
- Human-readable summaries for shell commands and file read/edit, with
  title/kind fallback.
- Inline failure reason on failed calls.
- Faithful replay on re-attach and reopen.
- Delivered in both CLI and web simultaneously.
- **Success criteria to proceed:** a run with mixed bash/read/edit calls,
  including at least one failure, renders one self-updating entry per call in
  both surfaces; reopening the finished run reproduces the final states.

### Phase 2 (future, not committed)

- Optional expandable detail (command output, file diff) behind a toggle.
- Richer per-kind presentation and result summaries.
- **Success criteria:** users can expand a call to inspect detail without
  cluttering the default view.

## Success Metrics

- **Legibility:** a user can identify what each tool call did and its outcome
  from the summary line alone, without reading raw agent output.
- **Line economy:** a single tool call occupies exactly one entry through its
  whole lifecycle (down from 3+ lines today).
- **Consistency:** rendering of a given finished run is identical across live
  view, re-attach, and reopen.
- **Parity:** the CLI and web surfaces present the same information and
  lifecycle for the same run.
- **No regressions:** runs with many tool calls remain responsive in both
  surfaces.

## Risks and Mitigations

- **Inconsistent agent data across IDEs** — different IDEs may provide
  different richness for command/file detail. *Mitigation:* always fall back to
  the action title/kind so every entry is meaningful.
- **Spinner flicker on fast calls** — rapid calls could flash a spinner
  distractingly. *Mitigation:* settle very fast calls directly to their final
  icon.
- **Scope creep toward detail panels** — the natural pull is to add output and
  diffs. *Mitigation:* hold the line on summary-only for MVP; detail is an
  explicit Phase 2.
- **Divergence between CLI and web** — two surfaces risk drifting. *Mitigation:*
  both consume one shared tool-call model (see ADR-001).

## Architecture Decision Records

- [ADR-001: Model tool calls as a first-class, identity-bearing run event](adrs/adr-001.md)
  — Tool calls become a distinct, persisted, id-keyed event consumed
  identically by the CLI and web, rather than free-text log lines or a
  renderer-only patch.

## Open Questions

- **Iconography:** exact glyphs/icons for each status in the terminal (and web)
  are left to design/implementation, provided they clearly distinguish pending
  / running / completed / failed.
- **Truncation rules:** the precise length/strategy for shortening long
  commands and file paths is to be settled during implementation.
- **Pending visibility:** whether the brief "pending" (pre-running) state
  warrants its own distinct icon or should visually match "running" is a minor
  design choice to confirm.
