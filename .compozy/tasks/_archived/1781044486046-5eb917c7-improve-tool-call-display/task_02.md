---
status: completed
title: summarizeToolCall pure domain helper
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 2: summarizeToolCall pure domain helper

## Overview
Add a pure `summarizeToolCall` function that maps ACP-derived inputs (kind,
title, rawInput, locations, content, cwd) to a complete display-ready
`ToolCallView`. This is the single authoritative mapping shared by both
surfaces, so the CLI and web show identical summaries; it owns command
extraction, file-path relativization/truncation, error-text extraction, and the
title/kind fallback.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/domain/tool-call.ts` exporting a pure `summarizeToolCall`
  function whose input/output match the TechSpec "Core Interfaces" (`ToolCallInput`
  → `ToolCallView`).
- MUST format titles per the TechSpec "Data Models" mapping table: `execute` →
  `Bash: <command>` from `rawInput.command`; `read` → `Read <relpath>`;
  `edit`/`delete`/`move` → corresponding verb + `<relpath>` from `locations[0]`;
  other kinds → `title` verbatim.
- MUST relativize file paths against `cwd` and truncate over-long commands/paths
  to a sensible cap.
- MUST populate `errorText` only when `status === "failed"`, extracted from the
  update `content`/`rawOutput` and capped to a short string.
- MUST fall back deterministically (`title` → kind label → generic `"Tool call"`)
  and MUST NOT throw on missing or malformed optional fields.
- MUST contain no I/O (pure function), consistent with the domain layer rule.

## Subtasks
- [x] 2.1 Define `ToolCallInput` and implement `summarizeToolCall` returning a
  `ToolCallView`.
- [x] 2.2 Implement per-kind title formatting with the fallback chain.
- [x] 2.3 Implement path relativization against `cwd` and command/path
  truncation.
- [x] 2.4 Implement short error-text extraction for failed calls.
- [x] 2.5 Cover mapping, fallback, truncation, and error extraction with unit
  tests.

## Implementation Details
Create `src/domain/tool-call.ts` importing `ToolCallView`/`ToolCallStatus` from
`src/domain/runner.ts`. Keep it dependency-free and side-effect-free. See the
TechSpec "Data Models" mapping table and ADR-003 for the parity rationale. Do
not persist or reference `rawInput`/`content` beyond extracting the display
strings.

### Relevant Files
- `src/domain/tool-call.ts` — new pure helper (this task).
- `src/domain/runner.ts` — source of `ToolCallView`/`ToolCallStatus` (from
  task_01).
- `src/domain/workflow.ts` — example of an existing pure domain module for style
  reference.

### Dependent Files
- `src/infra/acp/agent-session.ts` — calls `summarizeToolCall` in task_03.

### Related ADRs
- [ADR-003: Derive the tool-call summary in the domain and ship it in the event](adrs/adr-003.md)
  — This task is the concrete implementation of that decision.

## Deliverables
- `src/domain/tool-call.ts` with `summarizeToolCall` and `ToolCallInput`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the mapping across all relevant ACP kinds **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `execute` with `rawInput.command = "npm test"` → title `Bash: npm test`.
  - [x] `read` with `locations[0].path` under `cwd` → title `Read <relative
    path>` (cwd prefix stripped).
  - [x] `edit` with an absolute path outside `cwd` → title `Edit <path>` left
    readable (no crash).
  - [x] `status: "failed"` with an error message in `content` → `errorText`
    populated and truncated to the cap.
  - [x] Missing `rawInput`/`locations` falls back to `title`, then kind label,
    then `"Tool call"`.
  - [x] An over-length command is truncated to the configured maximum.
  - [x] Malformed `rawInput` (non-object) does not throw and yields a fallback
    title.
- Integration tests:
  - [x] A representative `tool_call`/`tool_call_update` payload per kind
    (`execute`, `read`, `edit`, `search`, `other`) produces the expected
    `ToolCallView`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `summarizeToolCall` is pure (no imports of `node:fs`, network, or process I/O).
- CLI and web will render identical titles because both consume this output.
