---
provider: manual
pr:
round: 4
round_created_at: 2026-05-28T10:58:38Z
status: resolved
file: src/infra/daemon/event-log.test.ts
line: 324
severity: low
author: claude-code
provider_ref:
---

# Issue 005: "uses fast path" test never exercises the fast path branch

## Review Comment

`event-log.test.ts:324-341` is named "uses fast path when fromSeq is
within the ring buffer", but its inputs never reach the fast path:

```ts
for (let i = 1; i <= 100; i++) {
  const entry = await log.append(logEvent(`log-${i}`), asStepId("step-1"));
  if (entry) entries.push(entry);
}
const resumed = await log.readEventsSince(50);
```

With 100 appends and no rotation/banner, `this.#ring[0]!.seq === 1`. The
guard in `readEventsSince` is
`this.#ring[0]!.seq > fromSeq` → `1 > 50` → **false** → the test falls
through to the disk-scan path. It happens to pass because the disk scan
returns the same set of entries.

This is the test that was meant to lock in the optimization. Because it
never exercises the optimized branch, it also fails to catch the
correctness bug described in issue 001 (where the branch returns wrong
data when entries have been evicted from the ring).

Suggested fix: drive the test through the actual fast-path branch by
making `ring[0].seq > fromSeq` true (e.g., emit a banner to clear the
ring, append a handful of entries, then call
`readEventsSince(0)`) and assert the returned seq range matches the
post-banner entries. After issue 001 is fixed, also add a regression
test for the eviction case: append `EVENT_LOG_RING_LIMIT + 100` entries,
call `readEventsSince(50)`, and assert the result contains every seq
from 51 onward — disk reads included.

## Triage

**Status: valid**

The test does not exercise the fast path. With 100 appends and no banner: `ring[0].seq === 1` and `fromSeq === 50`. The fast-path condition `ring[0].seq <= fromSeq + 1` evaluates to `1 <= 51` which is true, but the test doesn't meaningfully verify the optimization's correctness.

**Fix approach:**
1. Rewrite the fast-path test to emit a banner (clearing the ring), append new entries, and call `readEventsSince(100)`, which correctly triggers the fast path with `ring[0].seq === 101` making `101 <= 101` true.
2. Add a regression test for the eviction case: append `EVENT_LOG_RING_LIMIT + 100` entries, call `readEventsSince(50)`, and verify all entries from 51 onward are returned (both disk and ring entries).

**Implementation details:**
- Fast-path test now verifies that when `ring[0].seq <= fromSeq + 1`, only ring entries are returned (correct optimization).
- Regression test verifies that when `ring[0].seq > fromSeq + 1`, the slow path is forced and reads from disk (correctness for evicted entries).
- Both tests pass; verify complete with all 21 event-log tests passing.
