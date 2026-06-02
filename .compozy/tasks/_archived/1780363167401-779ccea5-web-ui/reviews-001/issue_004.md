---
provider: manual
pr:
round: 1
round_created_at: 2026-06-01T11:13:34Z
status: resolved
file: web/src/features/run-view/Transcript.tsx
line: 12
severity: low
author: claude-code
provider_ref:
---

# Issue 004: Transcript autoscroll and list keys are fragile during streaming

## Review Comment

Two minor issues in the live transcript that surface during high-frequency
streaming:

1. **Unconditional smooth autoscroll on every update.** The effect runs
   `endRef.current?.scrollIntoView({ behavior: 'smooth' })` on every change to
   `items`. The reducer emits a new view model per stream chunk, so during a
   chatty step this queues many overlapping smooth-scroll animations that fight
   each other (visible jank), and it also yanks the view back down even if the
   user has scrolled up to read earlier output. Prefer `behavior: 'auto'` and/or
   only autoscroll when the user is already near the bottom.

2. **Array index as React `key`.** `items.map((item, i) => <div key={i} ...>)`
   relies on the transcript being strictly append-only. The stream-coalescing
   path in `reducer.ts` replaces the last element in place, which happens to keep
   indices stable today, but the coupling is implicit and brittle. Use a stable
   key derived from the item, e.g. `key={`${item.seqStart}-${item.kind}`}`.

Both are low severity (the view works), but they affect the perceived quality of
the "live" experience that is a core PRD goal.

## Triage

- Decision: `VALID`
- Notes: Both sub-issues are confirmed in the code.

  **Sub-issue 1 (smooth autoscroll):** `Transcript.tsx:12-14` runs `scrollIntoView({ behavior: 'smooth' })` on every `items` change. The reducer creates a new array reference on every `stream` chunk (both for coalesced updates at line 100-105 of `reducer.ts` and new entries), so the effect fires per-chunk. Fix: add a `ref` to the scroll container, compute `distanceFromBottom = scrollHeight - scrollTop - clientHeight` after each render, and only call `scrollIntoView({ behavior: 'auto' })` when `distanceFromBottom < 100`.

  **Sub-issue 2 (array-index key):** `Transcript.tsx:21` uses `key={i}`. `TranscriptItem` has a `seqStart: number` field (the server sequence number when the item was first created) that is stable across coalescing updates. Using `key={\`${item.seqStart}-${item.kind}\`}` is safe: coalesced stream items keep the same `seqStart`, and all other items have globally-unique seq values. No key collisions are possible given the reducer's design.
