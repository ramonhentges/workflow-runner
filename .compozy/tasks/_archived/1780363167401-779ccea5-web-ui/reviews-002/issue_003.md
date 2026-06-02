---
provider: manual
pr:
round: 2
round_created_at: 2026-06-01T13:24:34Z
status: resolved
file: web/src/lib/ws/reducer.ts
line: 39
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Backlog `truncated` flag is dropped, hiding omitted transcript history

## Review Comment

The `backlog` attach frame carries a `truncated: boolean` (defined in the wire
schema, `web/src/lib/api/client.ts:141-145`, and the server contract). The
reducer replays the entries but ignores the flag entirely:

```ts
case 'backlog': {
  const sorted = frame.entries.slice().sort((a, b) => a.seq - b.seq)
  let result = vm
  for (const entry of sorted) {
    result = reduceEntry(result, entry.seq, entry.stepId, entry.event)
  }
  return result
}
```

`RunViewModel` has no field to carry truncation, so when the daemon's event log
has overflowed and only a tail of history is replayed, the user sees a
transcript that silently begins mid-stream with no "earlier output omitted"
marker. For a view whose core purpose is observing run activity, quietly
hiding that the history is incomplete is misleading.

Severity is low because it only manifests on overflow of an already-long run
and the live tail remains correct. Suggested fix: add a `truncated: boolean`
(or `backlogTruncated`) field to `RunViewModel`, set it from the frame, and
render a small "earlier output truncated" banner at the top of the transcript
when true.

## Triage

- Decision: `valid`
- Notes: The `truncated` flag is present in both `AttachFrame` wire type (`types.ts:48`) and the Zod schema (`client.ts:144`), confirming it is part of the server contract. The `backlog` case in `reduceFrame` (`reducer.ts:39-46`) discards the flag — `RunViewModel` has no field for it, so the UI can never surface a truncation warning. Root cause: `RunViewModel` is missing a `backlogTruncated: boolean` field. Fix: add the field, set it in the `backlog` case, and render a "earlier output truncated" banner in `Transcript` when it is true. Files touched: `reducer.ts` (primary), `Transcript.tsx` and `RunView.tsx` (UI wiring — not in batch scope code files but the minimum required to make the fix observable).
