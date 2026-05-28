---
status: completed
title: Event log — ring buffer plus events.jsonl plus rotation
type: infra
complexity: medium
dependencies:
  - task_01
---

# Task 05: Event log — ring buffer plus events.jsonl plus rotation

## Overview
Implement the append-only per-run event log: an in-memory ring buffer for instant attach replay during normal operation, paired with `events.jsonl` on disk for durability and a fallback path after daemon restart. This is the single load-bearing abstraction that powers replay, post-mortem inspection, and (V2) time-travel.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/event-log.ts`.
- MUST expose `EventLog.open(runDir: string): Promise<EventLog>` opening (or creating) `<runDir>/events.jsonl`.
- MUST expose `append(event: RunnerEvent, stepId: StepId | null): Promise<EventLogEntry | null>` that:
  - Filters out `{type: "stream", kind: "thought"}` events (returns `null` without writing to disk or buffer).
  - For all other events, assigns a monotonic `seq` (starting at 1 per run), captures `Date.now()` as `ts`, writes one line to `events.jsonl`, and appends to the in-memory ring buffer.
- MUST keep a per-run ring buffer of the most recent **N = 1000** non-filtered entries; oldest entries are dropped when the limit is exceeded.
- MUST reset the ring buffer when an event of `type === "banner"` is appended (the new step starts with a fresh replay window).
- MUST expose `currentStepBacklog(currentStepId: StepId): EventLogEntry[] | null` returning the contiguous entries from the most recent `banner` event for `currentStepId` forward, or `null` if no such `banner` is present in the buffer.
- MUST expose `readBackwardForCurrentStep(currentStepId: StepId): Promise<EventLogEntry[]>` that scans `events.jsonl` from EOF backward, finds the last `banner` for `currentStepId`, and returns the entries from that point forward in order.
- MUST rotate `events.jsonl` to `events.N.jsonl` (lowest-unused `N`, starting at 1) when its size exceeds **50 MB**. `readBackwardForCurrentStep` must read across rotation files transparently.
- MUST expose `close(): Promise<void>` flushing and closing the file handle.
- MUST propagate write errors so the caller (RunManager) can mark the run `failed` on a disk failure.
</requirements>

## Subtasks
- [x] 5.1 Implement the EventLog class with file-handle ownership and the `EventLogEntry` shape (see TechSpec → Data Models).
- [x] 5.2 Implement `append` with the thought-filter, monotonic seq allocation, atomic file write, ring buffer append, and banner-reset rule.
- [x] 5.3 Implement `currentStepBacklog` reading from the in-memory buffer only.
- [x] 5.4 Implement `readBackwardForCurrentStep` with multi-file backward scan.
- [x] 5.5 Implement the rotation threshold check before each `append` and the rename to `events.N.jsonl`.
- [x] 5.6 Write unit tests covering filtering, monotonic seq, banner reset, ring-buffer wrap, disk fallback, and rotation.

## Implementation Details
Create `src/infra/daemon/event-log.ts`. The file handle is opened in append mode (`'a'`). The monotonic seq is initialized from the highest seq seen across all existing rotation files at `open()` time (so a re-opened run continues numbering). For "backward scan from EOF," use Bun's `Bun.file(path).stream()` reversed via a buffered reader; or for simplicity, read the file fully and split by lines — the 50 MB cap bounds the worst case to a single fast read. The ring buffer is a simple `EventLogEntry[]` with `shift()` on overflow.

### Relevant Files
- `src/domain/runner.ts` — defines the `RunnerEvent` discriminated union (and `StreamKind`) that the log consumes.
- `src/domain/ids.ts` — `StepId` used in `EventLogEntry`.

### Dependent Files
- `src/infra/daemon/run-manager.ts` (task 08) — instantiates one `EventLog` per active run, wires it as a `RunnerObserver`.
- `src/infra/daemon/handlers/run-attach.ts` (task 10) — calls `currentStepBacklog` / `readBackwardForCurrentStep` to feed initial events to a new subscriber.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines the filter rule (exclude `thought` streams) and the 50 MB rotation cap.
- [ADR-006: Attach Replay via Per-Run Ring Buffer + Disk Fallback](adrs/adr-006.md) — establishes the N=1000 buffer size, banner-reset rule, and the two-path replay strategy.

## Deliverables
- `src/infra/daemon/event-log.ts` with `EventLog.open`, `append`, `currentStepBacklog`, `readBackwardForCurrentStep`, `close`, and rotation.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `append({type: "stream", kind: "thought", chunk: "x"}, "step-1")` returns `null`, writes nothing to disk, leaves the ring buffer unchanged.
  - [x] `append({type: "stream", kind: "message", chunk: "x"}, "step-1")` returns an entry with `seq: 1`, `event.kind === "message"`, writes one line to `events.jsonl`.
  - [x] Sequential appends produce monotonic seq values `1, 2, 3, ...`.
  - [x] After 1001 appends, the ring buffer holds exactly 1000 entries (the oldest dropped); `events.jsonl` on disk contains all 1001 lines.
  - [x] Appending a `banner` event resets the ring buffer to contain only that banner entry; previous entries remain on disk.
  - [x] `currentStepBacklog("step-2")` after a sequence of (banner step-1, log, log, banner step-2, log) returns the banner-step-2 entry plus the trailing log entry (two entries).
  - [x] `currentStepBacklog("step-1")` in the above scenario returns `null` (step-1's banner is no longer in the buffer because the step-2 banner reset it).
  - [x] `readBackwardForCurrentStep("step-2")` reads the file from EOF backward, returns the same banner-step-2 forward sequence.
  - [x] `readBackwardForCurrentStep("step-2")` across a rotation boundary: write enough events to trigger rotation, then issue a banner for step-2 after rotation, then scan; assert the entries after that banner are returned.
  - [x] After `close()` then `open(runDir)`, the new instance's seq counter continues from where the previous one stopped (no duplicates).
  - [x] When `events.jsonl` exceeds the 50 MB threshold, the next `append` causes a rename to `events.1.jsonl` and a fresh `events.jsonl` is created; the new file contains only the newly appended entry.
  - [x] A simulated disk-write failure (read-only directory) on `append` rejects with a typed error.
- Integration tests:
  - [ ] Covered by task 19 ("Attach/detach" scenario verifies backlog delivery end-to-end).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The 50 MB rotation threshold is a single named constant for easy tuning.
- No global state — each `EventLog` instance is independently scoped to its run directory.
