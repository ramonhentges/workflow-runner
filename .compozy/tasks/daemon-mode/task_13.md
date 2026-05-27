---
status: completed
title: CLI output formatting
type: infra
complexity: low
dependencies:
  - task_06
---

# Task 13: CLI output formatting

## Overview
Implement the formatting helpers used by `ps`, `doctor`, and any other command that prints structured data to the terminal: humanized durations (`3m12s`, `1h04m`, `2d 3h`), the narrow scannable `ps` table, the `doctor` subsystem report, and the ATTACHED marker glyph. Pure functions, easy to test.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/client/format.ts` (no I/O — returns strings).
- MUST expose `formatDuration(ms: number): string` returning `"3m12s"` / `"1h04m"` / `"2d 3h"` etc. per the table below.
- MUST expose `formatPsTable(rows: RunListEntry[]): string` returning a multi-line string with the columns `RUN  SLUG  WORKFLOW  STEP  STATUS  ELAPSED  ATTACHED`, narrow enough to fit 80 columns for typical id/slug/step widths.
- MUST expose `formatDoctorReport(report: DoctorReport): string` returning a per-subsystem `OK|WARN|FAIL` block with one-line details.
- MUST render `ATTACHED` as `●` when `attachedCount > 0`, empty string otherwise.
- MUST display only the basename of `workflowPath` (not the full directory).
- MUST sort terminal-state runs after active runs even if the input order is not pre-sorted (sort defensively).
- Duration table:
  - `< 60 s` → `"42s"`
  - `< 1 h` → `"3m12s"`
  - `< 24 h` → `"1h04m"` (zero-padded minutes)
  - `>= 24 h` → `"2d 3h"`
- MUST remain pure (no `console.log`, no `process.stdout.write` — return strings).
</requirements>

## Subtasks
- [x] 13.1 Implement `formatDuration` covering all four magnitude buckets.
- [x] 13.2 Implement `formatPsTable` with column widths computed from input data (avoid truncation of typical inputs).
- [x] 13.3 Implement `formatDoctorReport` with section-wise status formatting.
- [x] 13.4 Write unit tests covering every duration bucket, table edge cases (empty list, single row, mixed status), and doctor rendering for each status.

## Implementation Details
Create `src/infra/client/format.ts`. The table-formatting helper should compute each column's width as `max(min-width, max-content-width)` so short content stays narrow but long content (e.g., long workflow basenames) doesn't get truncated. Avoid third-party table libraries; the layout is small enough to hand-roll with `String.prototype.padEnd`. Color in the table is out of scope for this task — that lives in the TUI theme module if reused later.

### Relevant Files
- `src/infra/daemon/protocol.ts` (task 06) — `RunListEntry`, `DoctorReport` types.

### Dependent Files
- `src/app/commands/ps.ts` (task 15) — wraps `formatPsTable` and writes to stdout.
- `src/app/commands/doctor.ts` (task 16) — wraps `formatDoctorReport` and writes to stdout.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — locks in the `ps` columns, the humanized duration style, and the ATTACHED glyph choice.

## Deliverables
- `src/infra/client/format.ts` exporting `formatDuration`, `formatPsTable`, `formatDoctorReport`.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `formatDuration(42_000)` returns `"42s"`.
  - [x] `formatDuration(192_000)` returns `"3m12s"`.
  - [x] `formatDuration(3_840_000)` returns `"1h04m"` (zero-padded minute).
  - [x] `formatDuration(183_600_000)` returns `"2d 3h"`.
  - [x] `formatDuration(0)` returns `"0s"`.
  - [x] `formatPsTable([])` returns a header-only table with no data rows.
  - [x] `formatPsTable([oneRunningEntry])` returns 2 lines: header + 1 data row; the `ATTACHED` column shows `●` when `attachedCount > 0`.
  - [x] `formatPsTable` sorts active runs (`status: "running"`) before terminal-state runs even when the input is unsorted.
  - [x] `formatPsTable` shows the workflow basename (e.g., `who-is.json`), not the full path.
  - [x] Each row in `formatPsTable` stays under 80 visible columns for typical inputs (id 8 chars, slug ~15, workflow basename ~25).
  - [x] `formatDoctorReport({socket:{status:"OK"}, lockfile:{status:"OK"}, …})` produces one block per subsystem with `OK` markers.
  - [x] `formatDoctorReport` with a `WARN` subsystem includes both `WARN` and the supplied detail text.
- Integration tests:
  - [x] None — pure functions.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No I/O calls anywhere in the module (verified by grep for `console.` and `process.stdout`).
- Output is stable byte-for-byte for the same input (no `Date.now()` calls inside formatters).
