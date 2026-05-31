---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/app/api/routes/ws-attach.ts
line: 144
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: WS `fromSeq` is parsed without a NaN guard (diverges from HTTP)

## Review Comment

The WebSocket attach handler parses the resume cursor with a bare `parseInt`:

```ts
// src/app/api/routes/ws-attach.ts:144
const fromSeqStr = c.req.query("fromSeq");
const fromSeq =
  fromSeqStr !== undefined && fromSeqStr !== ""
    ? parseInt(fromSeqStr, 10)
    : undefined;
```

A malformed value such as `?fromSeq=abc` produces `NaN` (not `undefined`), which
then flows into the resume branch in `onOpen`:

```ts
if (fromSeq !== undefined) {           // true: NaN !== undefined
  const { entries, truncated } = await eventLog.readEventsSince(fromSeq) // readEventsSince(NaN)
```

`maxBacklogSeq` is also seeded as `fromSeq ?? 0` → `NaN`, and the later gap-read
`readEventsSince(maxBacklogSeq)` and the `entry.seq > NaN`-style comparisons all
silently misbehave (every comparison against `NaN` is false), so the client can
receive an empty or incorrect backlog with no error frame.

This is a fidelity gap against the HTTP `GET /runs/:id/events` path, which uses
`EventsQuerySchema` (`z.coerce.number().int().nonnegative().optional()`) and
cleanly rejects non-numeric `fromSeq` with a 400. The two transports should
treat the same query parameter consistently — stream fidelity and a non-drifting
contract are explicit goals.

Suggested fix: after `parseInt`, treat `Number.isNaN(fromSeq)` (and negative
values) as either `undefined` (ignore, initial-attach semantics) or send an
`error` frame and close — mirroring the HTTP validation. Consider parsing the WS
query through the same Zod schema to guarantee identical semantics.

## Triage

- Decision: `valid`
- Notes: Confirmed. `parseInt("abc", 10)` returns `NaN`. The condition `fromSeq !== undefined` is `true` for `NaN`, so `readEventsSince(NaN)` is called silently. All comparisons against `NaN` are false (every `entry.seq > NaN` is false), and `maxBacklogSeq = NaN ?? 0` = `NaN`, so the gap-read `readEventsSince(NaN)` also misbehaves. The HTTP path uses `EventsQuerySchema` (`z.coerce.number().int().nonnegative().optional()`) which cleanly rejects non-numeric values. Fix: validate `fromSeqStr` using the same Zod schema in the upgrade factory; on failure, store the error message in `PerConnectionOpts.fromSeqError` and reject with an error frame + close in `onOpen`.
