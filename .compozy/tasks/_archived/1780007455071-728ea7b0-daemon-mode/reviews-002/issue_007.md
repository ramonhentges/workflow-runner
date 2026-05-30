---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/event-log.ts
line: 322
severity: low
author: claude-code
provider_ref:
---

# Issue 007: Rotation reuses index 1 when older rotated files were deleted

## Review Comment

`nextRotatedPath` selects the lowest unused index by scanning sequentially:

```ts
for (let index = 1; ; index++) {
  const path = join(runDir, `events.${index}.jsonl`);
  if (!existsSync(path)) return path;
}
```

If a user (or a cleanup script) deletes `events.1.jsonl` but leaves
`events.2.jsonl` and `events.3.jsonl` in place, the next rotation will write
its content to `events.1.jsonl`. The numeric suffix is meant to encode age —
oldest first per `logFilesOldestFirst` — and after this rewrite that ordering
silently lies: `events.1.jsonl` now holds newer content than `events.2.jsonl`.
`readBackwardForCurrentStep` then walks files newest-first by suffix
(line 287) and may scan the wrong order, missing the banner it is looking for.

Fix: derive the next index from the **maximum** existing suffix + 1, not the
first gap.

```ts
async function nextRotatedPath(runDir: string): Promise<string> {
  const files = await logFilesOldestFirst(runDir);
  const maxRotation = files
    .map(f => f.rotation)
    .filter(r => Number.isFinite(r))
    .reduce((a, b) => Math.max(a, b), 0);
  return join(runDir, `events.${maxRotation + 1}.jsonl`);
}
```

This preserves the "suffix monotonically increases over time" invariant the
read path relies on. Worth a unit test that pre-populates an event-log
directory with non-contiguous rotation files and asserts the new file uses the
next-higher index.

## Triage

- Decision: `VALID`
- Root Cause: The `nextRotatedPath` function (line 340-347) finds the lowest unused index by scanning sequentially with `existsSync()`. If older rotated files are deleted, gaps are left and indices can be reused, violating the monotonic-increase invariant that `readBackwardForCurrentStep` and `logFilesOldestFirst` rely on for correct ordering.
- Fix Approach: Use `logFilesOldestFirst()` to find the maximum existing rotation suffix and use `max + 1` as the next index. Add a unit test that pre-populates non-contiguous rotation files and verifies the function returns the correct next index.
