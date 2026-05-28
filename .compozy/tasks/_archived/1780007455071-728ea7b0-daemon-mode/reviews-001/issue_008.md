---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/event-log.ts
line: 108
severity: medium
author: claude-code
provider_ref:
---

# Issue 008: EventLog rotation check stat()s the file on every append

## Review Comment

`#rotateIfNeeded` is called from `#appendPersisted` for every event and
unconditionally runs `await stat(this.#activePath)`. For high-throughput
streams (each `stream` event of kind=message becomes one append; long agent
outputs commonly produce hundreds of these per second), this is one extra
syscall per event, doubling the per-event I/O cost and increasing tail
latency on slow disks.

The active log only grows when we write to it, so the current size can be
tracked in memory and only re-stat'd after rotation or `open()`.

Suggested fix: maintain a `#activeBytes` counter, increment it by the written
buffer length, and consult it in `#rotateIfNeeded`; re-stat only on `open()`
to recover the size from a previous daemon run.

```typescript
async #appendPersisted(...) {
  if (this.#activeBytes > EVENT_LOG_ROTATE_BYTES) await this.#rotate();
  ...
  const bytes = Buffer.byteLength(line);
  await this.#handle.write(line);
  this.#activeBytes += bytes;
}
```

## Triage

- Decision: `valid`
- Root cause: `#rotateIfNeeded` calls `activeLogSize` → `stat(path)` on every `#appendPersisted` call. The active file only grows via `this.#handle.write()`, so its size is fully known in memory after `open()`. The one-time stat on `open()` is necessary to recover size from a previous daemon run, but per-append stats are redundant.
- Fix: add `#activeBytes` counter initialized from `activeLogSize` in `open()`, increment by `Buffer.byteLength(line)` after each successful write, check it in `#rotateIfNeeded` instead of stat-ing, and reset to 0 after rotation. Add optional `rotateBytes` parameter to `open()` so tests can use a small threshold instead of the `truncate`-after-open hack that no longer works with the in-memory counter.
