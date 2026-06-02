---
provider: manual
pr:
round: 3
round_created_at: 2026-06-01T13:45:01Z
status: resolved
file: web/src/lib/ws/reducer.ts
line: 49
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Reducer has no seq dedup, so initial attach can duplicate transcript items

## Review Comment

`reduceFrame`/`reduceEntry` apply every entry by appending to the transcript and
never track which sequence numbers have already been applied:

```ts
case 'event':
  return reduceEntry(vm, frame.entry.seq, frame.entry.stepId, frame.entry.event)
case 'backlog': {
  const sorted = frame.entries.slice().sort((a, b) => a.seq - b.seq)
  let result = { ...vm, backlogTruncated: frame.truncated }
  for (const entry of sorted) {
    result = reduceEntry(result, entry.seq, entry.stepId, entry.event)
  }
  return result
}
```

The daemon's attach ordering (`src/app/api/routes/ws-attach.ts`) registers the
live subscriber *before* it sends the `snapshot`/`backlog` frames, and during the
intervening `await flush()` / `await readEventsSince(maxBacklogSeq)` it both (a)
emits any concurrently-produced events live as `event` frames and (b) folds those
same seqs into the `backlog` frame via the gap-read. The server only dedups the
gap-read against the backlog it is building (its `seen` set) — it does **not**
account for events already pushed live. So when attaching to a run mid-step
(the common web case, where `backlog.length > 0` and the gap-read runs), the
client can receive the same `seq` twice: once as an early `event` frame and again
inside `backlog`.

Because the reducer dedups nothing, the duplicate is applied twice:

- a `log`/`status` event → the line appears twice in the transcript;
- a `banner` event → the `steps` array is guarded by an `exists` check, but the
  transcript branch always appends, so a duplicate step header is shown;
- a `stream` chunk → may be double-appended or mis-coalesced depending on
  interleaving.

This is a race (it needs an event to land in the ~one-await window during
initial attach), so it is intermittent, but it corrupts the core live view when
it occurs. Suggested fix: track the highest applied `seq` (or a `Set` of applied
seqs) on the view model and have `reduceEntry` ignore any entry whose `seq` has
already been applied. This also makes the client robust to any future
at-least-once delivery semantics on the wire.

## Triage

- Decision: `valid`
- Notes: The race is real. `ws-attach.ts` registers the live subscriber (line 424) before sending the snapshot/backlog frames, and the async `flush()` + `readEventsSince()` gap-read (lines 438–449) creates a window where new events can arrive as live `event` frames AND be folded into the backlog. The server's `seen` set (line 443) only deduplicates within the backlog being built — it cannot filter events already pushed live. The client reducer never deduplicates seqs, so the same seq is applied twice, corrupting the transcript (double lines, mis-coalesced stream chunks). Fix: add `appliedSeqs: Set<number>` to `RunViewModel`; in `reduceEntry` skip any seq already in the set; add the seq to a new Set on every successful state-changing application.
