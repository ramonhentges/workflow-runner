---
status: completed
title: CLI — --prompt flag (inline / stdin / file)
type: backend
complexity: medium
dependencies:
  - task_02
---

# Task 4: CLI — --prompt flag (inline / stdin / file)

# Overview
Add an optional `--prompt` flag to `workflow-runner start` so a user can direct a
run from the terminal. The flag accepts inline text, `-` to read the prompt from
stdin, and `@/path` to read it from a file — covering both short prompts and long,
multi-line briefs — then forwards the resolved text to the `run.start` RPC.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST parse `--prompt <value>` and `--prompt=<value>` in `parseStartArgs`,
  alongside the existing `--branch` and `--detach`/`-d` flags.
- MUST treat `--prompt -` as "read from stdin" and `--prompt @<path>` as "read from
  file", with inline text otherwise (a literal leading `@`/`-` can be supplied via
  stdin).
- MUST resolve the prompt source in `commands/start.ts` using injectable readers
  (mirroring `send`'s injected `readStdin`) so tests need no real stdin/filesystem.
- MUST forward the resolved `initialPrompt` in the `run.start` call and omit it when
  the flag is absent.
- MUST update `USAGE.start` to document the flag and its three modes.
- MUST return a clear parse error when `--prompt` is given without a value.
</requirements>

## Subtasks
- [x] 4.1 Add `initialPrompt?` to `StartArgs` and parse `--prompt`/`--prompt=` with `-`/`@file`/inline sentinels in `parseStartArgs`.
- [x] 4.2 Update `USAGE.start` to include `[--prompt <text|-|@file>]`.
- [x] 4.3 Resolve the prompt source in `commands/start.ts` via injectable stdin/file readers.
- [x] 4.4 Forward the resolved prompt to the `run.start` call; omit when absent.
- [x] 4.5 Add unit tests for flag parsing and source resolution.

## Implementation Details
See TechSpec "Data Models" (StartArgs) and "Known Risks" (arg-parsing edge cases).
Follow the existing `--branch` parsing structure in `parseStartArgs` and the
`deps.readStdin` injection pattern in `commands/send.ts` for stdin; add an analogous
injectable file reader. Do not reproduce arg-parser code — reference the TechSpec.

### Relevant Files
- `src/app/cli.ts` — `StartArgs`, `parseStartArgs`, `USAGE.start`.
- `src/app/commands/start.ts` — resolve prompt source and forward in `run.start`.
- `src/app/commands/send.ts` — reference for the injectable `readStdin` pattern.

### Dependent Files
- `src/infra/daemon/protocol.ts` — `run.start` params (already extended in task 02).

### Related ADRs
- [ADR-002: Inbound-message kind discriminator for kickoff framing](../adrs/adr-002.md) — context for what the prompt becomes server-side (informational).

## Deliverables
- `--prompt` flag with inline/`-`/`@file` modes parsed in `parseStartArgs`.
- Source resolution in `commands/start.ts` via injectable readers, forwarded to `run.start`.
- Updated `USAGE.start` help text.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the command resolving and forwarding the prompt **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `parseStartArgs(["wf.json", "--prompt", "hello"])` yields `initialPrompt === "hello"`.
  - [x] `parseStartArgs(["wf.json", "--prompt=hello"])` yields `initialPrompt === "hello"`.
  - [x] `parseStartArgs(["wf.json", "--prompt"])` returns a parse error ("--prompt requires a value").
  - [x] `parseStartArgs(["wf.json", "--prompt", "-", "--branch", "b", "-d"])` parses prompt-from-stdin together with branch and detach.
- Integration tests:
  - [x] `start` with `--prompt "x"` calls `run.start` with `initialPrompt: "x"` (mocked client).
  - [x] `start` with `--prompt -` reads the injected stdin reader and forwards its contents.
  - [x] `start` with `--prompt @file` reads the injected file reader and forwards its contents.
  - [x] `start` without `--prompt` calls `run.start` with no `initialPrompt`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A user can direct a run from the CLI via inline text, stdin, or a file.
- Omitting `--prompt` leaves `start` behavior identical to today.
