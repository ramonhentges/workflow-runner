---
provider: manual
pr:
round: 5
round_created_at: 2026-05-22T21:59:45Z
status: resolved
file: src/runner.ts
line: 119
severity: low
author: claude-code
provider_ref:
---

# Issue 002: Step banner index can exceed the total step count on revisits

## Review Comment

In `runWorkflow` (`src/runner.ts`), `stepIndex` starts at 1 and increments once
per loop iteration (line 121), while `totalSteps` is the fixed config step count
(`workflow.steps.length`, line 96). Both are passed to `ui.banner(step,
stepIndex, totalSteps)` (line 119), which renders `Step ${index}/${total}` in
`index.ts`.

The two values measure different things: `stepIndex` is a visit counter, while
`totalSteps` is the number of distinct steps declared. They only line up for a
strictly linear, no-revisit run. As soon as a workflow legitimately revisits a
step (a step appears twice on the executed path, well within `maxIterations`),
the banner renders something like `Step 4/3` — a count that exceeds its own
denominator and reads as a bug to the user. With `--start` mid-workflow the
banner can also under-count relative to the user's mental model.

Suggested fix: stop pairing a visit counter with a static total. Either:
- Drop the denominator and render a plain visit counter, e.g. `Step 4: <id>`
  (`banner(step, index)`), or
- Rename the parameter and label so it is unambiguous, e.g. `Visit 4 — <id>`.

This is cosmetic (observability only) and does not affect routing or outcomes.

## Triage

- Decision: `VALID`
- Notes: When workflows legitimately revisit steps, the banner would display something like `Step 4/3` (visit count / total steps), which is confusing and reads as a bug. This is a real issue in observable behavior.

## Implementation

Changed the `RunnerUi.banner()` interface to remove the `total: number` parameter and updated:
1. `runner.ts`: Updated interface definition, removed `totalSteps` variable, changed call to `ui.banner(step, stepIndex)`
2. `index.ts`: Updated banner implementation to render `Step ${index}: ${step.id}` without the denominator

This fixes the cosmetic issue while maintaining full context (step ID and visit number) in the output.

**Testing:** All 73 unit tests pass, TypeScript type checking passes, build succeeds.
