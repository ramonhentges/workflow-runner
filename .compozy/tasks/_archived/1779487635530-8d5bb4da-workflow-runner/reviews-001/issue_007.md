---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/index.ts
line: 543
severity: medium
author: claude-code
provider_ref:
---

# Issue 007: End-of-run summary is rendered twice

## Review Comment

`runWorkflow` already renders the summary as its final action — `runner.ts`
line 161 calls `ui.summary(summary)` before returning. `main()` then calls it
again on line 543:

```ts
const summary = await runWorkflow({ ... }); // ui.summary already fired inside
runnerUi.summary(summary);                  // duplicate render
```

The result is two summary blocks (the `━━━` divider, the visited-steps list,
the finish message, and the duration) printed back to back in the log, and the
status line is set twice. This is a visible cosmetic defect in the end-of-run
output the PRD calls out as a first-class feature.

Suggested fix: pick one owner for summary rendering. Either remove the
`ui.summary(summary)` call inside `runWorkflow` and let the caller render it, or
remove the duplicate call in `main()`. Given `runWorkflow` returns the
`RunSummary`, having the caller render it is the cleaner contract — but only one
site should call `ui.summary`.

## Triage

- Decision: `VALID`
- Notes: The issue correctly identifies a duplicate summary render. Removed the `ui.summary(summary)` call from inside `runWorkflow()` at runner.ts:165 to consolidate rendering responsibility with the caller. This follows the cleaner contract where the function returns the summary and lets the caller decide how to render it.

## Implementation

Removed the redundant `ui.summary(summary)` call from `runWorkflow()` in `src/runner.ts` (line 165), allowing the single call in `main()` at `src/index.ts` line 547 to be the sole owner of summary rendering.

## Verification

Executed full verification pipeline:
- TypeScript type checking: PASS (no errors)
- Test suite: PASS (49 pass, 0 fail)
- Build: PASS (bundled successfully in 39ms)
