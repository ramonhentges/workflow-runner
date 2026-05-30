# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Pure formatter module `src/infra/client/format.ts` exporting `formatDuration`, `formatPsTable`, `formatDoctorReport`, consumed later by `ps`/`doctor` app commands (tasks 15/16).

## Important Decisions

- `formatPsTable(rows, now?: number)`: extended the spec signature with an optional `now` so `ELAPSED` for running rows is computable without `Date.now()` inside the module. When `now` is omitted, elapsed for a still-running row is `0` (caller responsibility to pass `Date.now()`).
- Within-group ordering: active rows first, then terminal-state rows; within each group sorted by recency (most-recent `endedAt ?? startedAt` first), matching the techspec's "active runs first, then terminal-state runs … sorted by recency."
- `currentStepId: null` renders as `-` (single dash) to keep the column non-empty and width-stable.
- Seconds are zero-padded in the `<1h` bucket (e.g. `1m05s`) for visual consistency with the `1h04m` minute padding; the spec example `3m12s` is ambiguous on padding, so consistency wins.
- Doctor detail strings: `socket` and `lockfile` carry no count/bytes, so they show only the status (with `lockfile.detail` appended when present). The other four subsystems render `count=N` / `bytes=N` to satisfy the "one-line details" requirement deterministically.
- Casing reconciliation: task_13's prose example uses `status:"OK"` for the doctor input, but `protocol.ts` (task_06) defines `DoctorStatus = "ok" | "warn" | "fail"`. Treated the prose as informal — kept input lowercase per protocol; output uppercases to `OK`/`WARN`/`FAIL`.

## Learnings

- Pure formatters that need a "now" must accept it explicitly to stay deterministic; the spec's "no `Date.now()` calls inside formatters" rule is satisfied by parameter injection rather than computing the anchor inside the function.
- `padEnd` per column with a 2-space separator and a `trimEnd` on the final assembled row gives clean, fixed-width output without trailing whitespace on rows whose final cell is empty (e.g. unattached `ATTACHED`).

## Files / Surfaces

- `src/infra/client/format.ts` — new module (3 exports + private helpers).
- `src/infra/client/format.test.ts` — 21 unit tests, 56 expect() calls.

## Errors / Corrections

(none)

## Ready for Next Run

- Tasks 15 (`app/commands/ps.ts`) and 16 (`app/commands/doctor.ts`) can import `formatPsTable`/`formatDoctorReport` directly; `ps.ts` is responsible for passing `Date.now()` as the second argument.
- Output is stable byte-for-byte; snapshot tests in downstream commands are safe to add if desired.
