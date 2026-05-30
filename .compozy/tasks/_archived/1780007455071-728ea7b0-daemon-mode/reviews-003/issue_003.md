---
provider: manual
pr:
round: 3
round_created_at: 2026-05-28T10:39:05Z
status: resolved
file: src/infra/daemon/event-log.ts
line: 171
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: readEventsSince scans every rotated log file on every resume

## Review Comment

`readEventsSince` (event-log.ts:171-187) reads every entry from every log
file in `runDir` for every call:

```ts
const files = await logFilesOldestFirst(this.runDir);
const result: EventLogEntry[] = [];
for (const file of files) {
  const entries = await readEntries(file.path);
  for (const entry of entries) {
    if (entry.seq > fromSeq) {
      result.push(entry);
    }
  }
}
```

For a long-lived run with `EVENT_LOG_ROTATE_BYTES = 50 MiB` rotated files
(event-log.ts:15), a single resume after a transient disconnect can:

- Read tens or hundreds of megabytes from disk.
- Parse every JSON line with `JSON.parse` (event-log.ts:289).
- Allocate an `EventLogEntry[]` for every file, then discard most entries.
- Block the daemon's event loop on the disk I/O and parsing.

Two consequences:

1. Performance: `attachSubscriber` (and therefore RPC dispatch) is delayed
   by a full log scan on every reconnect. For active runs the gap also
   widens the race window described in issue 002.
2. Memory: the returned backlog is unbounded. The RPC response and the
   client-side replay both hold the full list in memory, then encode it
   over the UDS.

Suggested fix:

- Fast path the in-memory ring: if `fromSeq >= this.#ring[0]?.seq - 1`,
  return `this.#ring.filter(e => e.seq > fromSeq)` directly — no disk
  read needed for short reconnects (the common case).
- Cap or short-circuit the disk scan: since `logFilesOldestFirst` is
  numerically ordered and seqs are monotonic, the first file whose
  `entries[last].seq <= fromSeq` can be skipped entirely; the first file
  whose `entries[0].seq > fromSeq` can be appended without per-entry
  filtering.
- Consider a hard cap on the returned backlog size (with a "resume from a
  later seq" hint) so a long-disconnected client cannot OOM the daemon.

## Triage

- Decision: `VALID`
- Root cause: `readEventsSince` reads and parses every entry from every log file unconditionally, without leveraging the in-memory ring buffer or optimizing the disk scan.
- Impact: On resume after a transient disconnect, the method can read tens/hundreds of MiB from disk, parse all JSON lines, and allocate unbounded memory for the backlog. This blocks the daemon's event loop and widens the race window during reconnect.
- Fix approach:
  1. Fast path: if `fromSeq >= this.#ring[0]?.seq`, return filtered ring entries (no disk I/O for common case of short reconnects)
  2. Optimized disk scan: skip files where the last entry's seq <= fromSeq, and once we find a file where the first entry > fromSeq, append all remaining entries without filtering
  3. Hard cap on backlog: limit returned entries to prevent OOM on extreme disconnects, with a hint to resume from a later seq
