---
provider: manual
pr:
round: 4
round_created_at: 2026-05-28T10:58:38Z
status: resolved
file: src/infra/daemon/event-log.ts
line: 177
severity: critical
author: claude-code
provider_ref:
---

# Issue 001: readEventsSince ring fast-path drops events evicted from ring

## Review Comment

`readEventsSince` (event-log.ts:175-179) introduces a ring fast-path:

```ts
if (this.#ring.length > 0 && this.#ring[0]!.seq > fromSeq) {
  return this.#ring.filter(e => e.seq > fromSeq);
}
```

The intent (per the test name in `event-log.test.ts:324`) is "fast path when
`fromSeq` is within the ring buffer". The implemented condition is the
*opposite*: it returns ring entries exactly when the ring's oldest entry is
*newer* than `fromSeq` — which is precisely when entries between
`fromSeq + 1` and `ring[0].seq - 1` have been **evicted** from the ring (or
cleared by a banner event at `#appendToRing`, line 261-263) and only exist
on disk.

Concrete failure:

- The ring holds at most `EVENT_LOG_RING_LIMIT` (1000) entries and is
  reset on every `banner` event.
- A long-running step (or any run that has produced >1000 events since the
  most recent banner) holds, e.g., seqs `[5000..5999]` in the ring.
- A client resumes with `fromSeq=100`. `ring[0].seq = 5000 > 100` → fast
  path triggers → returns `[5000..5999]`, silently dropping
  `[101..4999]` (which are on disk).

This breaks the documented resume contract (`_techspec.md:306` — "`fromSeq`
lets a client resume after a transient disconnect") and is the very
correctness bug that the reviews-003 issue 003 fix and reviews-002 issue
003 fix were meant to guarantee. The test at `event-log.test.ts:324` does
not catch it because it uses `fromSeq=50` with ring entries starting at
seq 1, so `ring[0].seq=1 > 50` is false and the fast path is never taken.

Suggested fix: invert the condition so the fast path only fires when the
ring's oldest entry is *at or before* `fromSeq` (i.e., the ring covers
every seq the caller wants):

```ts
if (this.#ring.length > 0 && this.#ring[0]!.seq <= fromSeq + 1) {
  return this.#ring.filter(e => e.seq > fromSeq);
}
```

Add a regression test that appends `> EVENT_LOG_RING_LIMIT` events (or
emits a banner to clear the ring), then calls `readEventsSince(fromSeq)`
for an evicted `fromSeq` and asserts the returned seq range is
contiguous from `fromSeq + 1` to the last appended seq.

## Triage

- Decision: `valid`
- Root cause: The condition on line 177 has inverted logic. It triggers the fast path when `ring[0].seq > fromSeq`, meaning the ring's oldest entry is newer than what the caller requested — this is exactly when entries are *missing* from the ring and live only on disk. The fast path should only trigger when the ring's oldest entry is *at or before* `fromSeq`, ensuring we don't skip any requested events.
- Intended fix: Invert the condition to `this.#ring[0]!.seq <= fromSeq + 1` so the fast path only fires when the ring covers the full requested range. Add a regression test that appends >1000 events (causing ring eviction), then calls `readEventsSince` for an evicted seq and asserts contiguity.
