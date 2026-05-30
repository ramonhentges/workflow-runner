---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 16
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: run.attach silently ignores the fromSeq resume parameter

## Review Comment

`protocol.ts:41` defines `run.attach` params as
`{ runId: RunId; fromSeq?: number }`, and the TechSpec explicitly calls out
that "`fromSeq` lets a client resume after a transient disconnect"
(_techspec.md:306). The handler implementation in `run-attach.ts` reads only
`params.runId` and discards `fromSeq`, so a client reconnecting after a UDS
drop receives the **current step's** backlog instead of all events with
`seq > fromSeq`. Any events from earlier steps that the client missed during
the disconnect are lost (the events are on disk but the handler never reads
them).

This breaks the documented resume contract. Two options for a fix:

1. Honor `fromSeq`: when provided, the handler should read every event in
   `events.jsonl`/`events.N.jsonl` with `seq > fromSeq` and return that as the
   backlog instead of `currentStepBacklog` / `readBackwardForCurrentStep`.
2. If V1 truly does not support resume, remove `fromSeq` from `protocol.ts` and
   the TechSpec so the surface area matches the implementation.

Pick one and align the protocol, the handler, and the techspec — leaving an
accepted-but-ignored param is a silent footgun.

## Triage

- Decision: `valid`
- Notes: The TechSpec explicitly documents `fromSeq` as a parameter to enable resume-after-disconnect (techspec.md:306). The handler currently ignores this parameter and always returns only the current step's backlog, which breaks the documented contract. Option 1 (honor `fromSeq`) is the correct fix — clients need the ability to recover missed events after transient disconnects.

## Implementation

**Files modified:**

1. **src/infra/daemon/event-log.ts** — Added `readEventsSince(fromSeq: number)` public method that reads all events from disk files with `seq > fromSeq`, supporting resume after disconnect.

2. **src/infra/daemon/handlers/run-attach.ts** — Updated handler to check `params.fromSeq`:
   - If `fromSeq` is provided: returns all events since that sequence number (enables resume-after-disconnect)
   - If `fromSeq` is not provided: returns current step backlog (maintains backward compatibility for initial attach)

3. **src/infra/daemon/event-log.test.ts** — Added three comprehensive tests:
   - `reads all events with seq > fromSeq for resume`
   - `returns empty array when fromSeq >= latest seq`
   - `reads events from rotated files for resume across rotation boundary`

**Verification:**

- ✓ Type checking passes (`bun run typecheck`)
- ✓ All 418 tests pass (417 pass, 1 skip, 0 fail), including 3 new tests for `readEventsSince`
- ✓ Full build succeeds (`bun run build`)
- ✓ No regressions detected in existing handler tests

The implementation honors the TechSpec contract: clients can now resume after transient disconnects by providing `fromSeq`, and the handler returns all events missed during the disconnect.
