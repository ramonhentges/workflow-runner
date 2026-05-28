---
status: completed
title: Run store — meta.json persistence and discovery
type: infra
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 04: Run store — meta.json persistence and discovery

## Overview
Implement the on-disk persistence and discovery layer for runs: atomic `meta.json` writes per run, durable enumeration of run directories on daemon startup, and the rule that maps orphaned in-flight runs to `crashed` status. This is the source of truth that survives daemon crashes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/run-store.ts`.
- MUST resolve the storage root as `$XDG_STATE_HOME/workflow-runner/`, falling back to `~/.local/state/workflow-runner/` when the env var is unset.
- MUST expose `persist(snapshot: RunSnapshot): Promise<void>` using atomic write (write to `meta.json.tmp`, `fsync`, then `rename` to `meta.json`).
- MUST expose `load(runId: RunId): Promise<RunSnapshot>` reading and validating `meta.json` for a given run.
- MUST expose `listAll(): Promise<RunSnapshot[]>` enumerating every run directory under `runs/`, skipping (with a logged warning) directories whose `meta.json` is missing or malformed.
- MUST expose `discoverAndMarkOrphans(): Promise<RunSnapshot[]>` that calls `listAll()` and, for any snapshot with `status === "running"`, persists an updated snapshot with `status === "crashed"` and `endReason === "daemon restart"`, returning the *post-update* snapshots.
- MUST validate `schemaVersion === 1` on load; reject with a clear error otherwise.
- MUST create the storage root and `runs/` subdirectory on first use if they do not exist.
- MUST set permissions `0700` on directories and `0600` on `meta.json` files.
- MUST tolerate a crashed write (presence of a `meta.json.tmp` that was never renamed) by ignoring the `.tmp` file on load and leaving it for `discoverAndMarkOrphans` to clean up.
</requirements>

## Subtasks
- [x] 4.1 Implement storage-root resolution (`$XDG_STATE_HOME` → `~/.local/state`) and lazy directory creation.
- [x] 4.2 Implement `persist(snapshot)` with the atomic write protocol (tmp → fsync → rename).
- [x] 4.3 Implement `load(runId)` with JSON parse, `schemaVersion` check, and shape validation.
- [x] 4.4 Implement `listAll()` with malformed-directory skipping.
- [x] 4.5 Implement `discoverAndMarkOrphans()` that mutates running snapshots to `crashed` and persists the change.
- [x] 4.6 Write unit tests against a temp directory for every method including the partial-write recovery case.

## Implementation Details
Create `src/infra/daemon/run-store.ts`. Use Bun's filesystem APIs (`Bun.write`, `Bun.file`) plus `node:fs` for `fsync` (Bun does not yet ship a sync-and-rename helper, so use `openSync` + `writeSync` + `fsyncSync` + `closeSync` + `rename`). The `fsync` is on the file descriptor of `meta.json.tmp` before `rename`. Run directory layout is documented in TechSpec → "Data Models" → disk layout block. The `schemaVersion: 1` field is mandatory in serialized form; the `Run` class itself does not carry it, so `RunStore` is responsible for adding it on `persist` and stripping/validating it on `load`.

### Relevant Files
- `src/domain/run.ts` (task 01) — provides `RunSnapshot`, `RunStatus`, `RunId`.
- `src/domain/run-id.ts` (task 02) — provides `RunId` type for `load(runId)` parameter.

### Dependent Files
- `src/infra/daemon/run-manager.ts` (task 08) — uses `persist`/`load`/`discoverAndMarkOrphans` to manage run state.
- `src/infra/daemon/daemon.ts` (task 11) — calls `discoverAndMarkOrphans()` on startup.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines daemon-restart discovery rule (orphans become `crashed`, no auto-resume).
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — places `RunStore` in `infra/daemon/`.

## Deliverables
- `src/infra/daemon/run-store.ts` with `persist`, `load`, `listAll`, `discoverAndMarkOrphans`, and storage-root resolution.
- Directory structure created on first use with correct permissions.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `persist(snapshot)` creates `<root>/runs/<id>/meta.json` containing the snapshot plus `schemaVersion: 1`.
  - [x] `persist(snapshot)` is atomic: simulate a crash by killing the process mid-write (in a fork) and assert that `meta.json` either contains the previous valid content or does not exist, never partial content.
  - [x] `persist` followed by `load(snapshot.id)` returns a deep-equal snapshot.
  - [x] `load(id)` on a nonexistent run id throws a typed `RunStoreError` whose message names the missing path.
  - [x] `load(id)` on a file with `schemaVersion: 2` throws a typed error mentioning the unsupported version.
  - [x] `load(id)` on malformed JSON throws a typed error mentioning the file path.
  - [x] `listAll()` returns all valid run snapshots in arbitrary order; skips a directory with a missing `meta.json` (no throw); skips a directory with malformed JSON (no throw, logged warning).
  - [x] `discoverAndMarkOrphans()`: seed three runs (status `running`, `completed`, `running`), call once, assert the two `running` snapshots are now `crashed` on disk with `endReason === "daemon restart"` and a non-null `endedAt`.
  - [x] `discoverAndMarkOrphans()` is idempotent — calling twice does not change `crashed` runs further.
  - [x] `persist` with no existing `runs/` directory creates it with mode `0700`.
  - [x] On a fresh empty root, the resolved storage-root path equals `$XDG_STATE_HOME/workflow-runner` when the env var is set, and `~/.local/state/workflow-runner` when it is not.
  - [x] `load` ignores a stray `meta.json.tmp` file (does not attempt to read it).
- Integration tests:
  - [ ] Covered by task 19 ("Daemon-restart discovery" scenario) end-to-end.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Files written under a temp root during tests have `0600` mode; directories `0700`.
- No mutation of process global state (env vars, cwd).
