---
provider: manual
pr:
round: 2
round_created_at: 2026-05-22T20:26:37Z
status: resolved
file: src/runner.ts
line: 96
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: runWorkflow has no cycle or iteration cap

## Review Comment

`runWorkflow` advances steps in an unbounded `while (true)` loop, transitioning
on every `handoff` outcome:

```ts
while (true) {
  const step = steps.get(currentStepId);
  ...
  } else if (stepOutcome.kind === "handoff") {
    currentStepId = stepOutcome.nextStep;
    inboundMessage = stepOutcome.message;
  }
}
```

Edges may legitimately form cycles (`step-1 → step-2 → step-1 → ...`), and
`resolveHandoffTarget` happily accepts any declared edge target. If the agents
keep handing off around a cycle — easy for an LLM to do when edge `intent`
descriptions overlap — the loop never terminates. Each iteration spawns a fresh
`opencode acp` subprocess and pushes onto the `visited` array, so this is a
runaway: unbounded process spawning, unbounded memory growth, and a run that
never reaches the end-of-run summary or the halt-and-report failure path.

The PRD's failure handling enumerates three halt cases (agent crash, invalid
handoff target, step ending without a tool call); an infinite valid-handoff
loop is a fourth failure mode with no safeguard. "Keep every run observable" and
"halt with a clear explanation rather than hang" both argue for a bound.

Suggested fix: add a maximum-step-count guard (e.g. a small multiple of
`workflow.steps.length`, or a configurable cap). When the cap is exceeded, break
the loop with a `failure` outcome whose reason explains the runaway and lists
the recent step sequence, so the run halts and reports per the PRD instead of
spinning forever.

## Triage

- Decision: `valid`
- Notes: The unbounded loop is a real safety issue. Cycles are possible when step edges form loops and agents consistently hand off between them. This creates a runaway with unbounded subprocess spawning and memory growth. A maximum-step-count guard is necessary to prevent infinite execution.

## Implementation

**Changes made:**
1. Added `maxIterations` optional field to `RunOptions` interface
2. Added iteration tracking in `runWorkflow()` with a default limit of `Math.max(1, workflow.steps.length * 10)`
3. Added a check that breaks the loop with a failure outcome when the limit is exceeded
4. The failure message includes the recent step sequence to help diagnose the cycle

**Tests added:**
- `detects step cycles and halts with appropriate message`: Verifies that a cyclic workflow is detected and halted
- `uses default maxIterations based on step count`: Verifies the default calculation works correctly

**Verification results:**
- All 19 runner tests pass (including 2 new tests for cycle detection)
- All 62 total tests pass across the project
- No warnings or errors
