---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/runner.ts
line: 300
severity: high
author: claude-code
provider_ref:
---

# Issue 004: Handoff message is never forwarded to the next step

## Review Comment

The handoff message — the only state that the design allows to cross a step
boundary — is silently dropped on every transition.

In `runWorkflow`, when a step resolves `{ kind: "handoff", nextStep, message }`,
only `currentStepId = stepOutcome.nextStep` is used; `stepOutcome.message` is
discarded. `setupStepSession` is then called and unconditionally invokes
`buildKickoffPrompt(step, null)` (line 300) — the `inboundMessage` parameter is
always `null`. `buildKickoffPrompt` and the `StepContext.inboundMessage` type
both exist to carry this value, but nothing ever populates it.

This violates PRD Core Feature 5 ("starts the next step with that message as its
opening context"), the TechSpec data-flow step 8 ("advances to `nextStep`
(passing the handoff `message`)"), and the TechSpec "Kickoff prompt composition"
note ("plus, when present, `Context from previous step: <handoff message>`").
The receiving agent starts with no context from the previous step.

Suggested fix: thread the handoff message through. Capture it in the loop (e.g.
`let inboundMessage: string | null = null`; set it from `stepOutcome.message` on
handoff), pass it into `setupStepSession`, and have that function call
`buildKickoffPrompt(step, inboundMessage)`.

## Triage

- Decision: `valid`
- Notes: The issue is confirmed. `runWorkflow` discards `stepOutcome.message` on handoff (line 134), and `setupStepSession` always passes `null` to `buildKickoffPrompt` (line 303). The fix is to thread the message through: capture it in the loop, pass it to `setupStepSession`, and use it in the kickoff prompt.

## Implementation

Fixed by threading the handoff message through the workflow:

1. **Line 81**: Added `let inboundMessage: string | null = null;` to track the message between steps
2. **Line 104**: Updated `setupStepSession` call to pass `inboundMessage`
3. **Line 136**: Captured the message on handoff: `inboundMessage = stepOutcome.message;`
4. **Line 174**: Updated `setupStepSession` signature to accept `inboundMessage: string | null` parameter
5. **Line 306**: Updated `buildKickoffPrompt` call to use `inboundMessage` instead of `null`

The kickoff prompt now includes "Context from previous step: {message}" when transitioning between steps, fulfilling PRD Core Feature 5.

## Verification

- TypeScript type checking: ✅ PASS (0 errors)
- Test suite: ✅ PASS (49 tests, 0 failures)
- Build: ✅ PASS (103 modules bundled)
