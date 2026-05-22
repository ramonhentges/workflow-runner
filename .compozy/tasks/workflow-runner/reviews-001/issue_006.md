---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/runner.ts
line: 189
severity: high
author: claude-code
provider_ref:
---

# Issue 006: Per-step permission handler cancels every request

## Review Comment

In `setupStepSession`, the `AcpClient` for every step's session is given a
`requestPermission` handler that unconditionally returns
`{ outcome: { outcome: "cancelled" } }`:

```ts
requestPermission: async (params) => {
  ui.log(`Permission requested: ${params.toolCall.title}`);
  return { outcome: { outcome: "cancelled" } };
},
```

Every permission-gated action the step's agent attempts is denied. For
autonomous steps there is no user and no recourse — any tool requiring approval
simply fails. This directly threatens the MVP milestone: `who-is.json` requires
each agent to write a file (`./agent.txt`, `./agent-2.txt`, ...); if opencode
routes those writes through `session/request_permission` rather than the ACP
`fs/write_text_file` capability, the agent can never complete its step.

It is also inconsistent with `index.ts` `handlePermission`, which renders the
options and lets the user choose — that richer handler is wired only to the
unused init connection (see issue 010) and never reaches a real step.

Suggested fix: give the runner a real permission policy. For interactive steps,
surface the prompt to the TUI (as `handlePermission` already does) so the user
can decide; for autonomous steps, auto-approve a sensible default option (e.g.
the first non-reject option) rather than cancelling, or make the policy
configurable. Cancelling everything should not be the default.

## Triage

- Decision: `VALID`
- Notes: The issue accurately identifies a critical blocker: autonomous steps cannot complete file writes because every permission request is cancelled. The MVP milestone requires agents to write files, making this a legitimate issue.

## Solution

Modified the `requestPermission` handler in `setupStepSession` (src/runner.ts:195-217) to:
1. Log permission details (kind and paths) for visibility
2. Find and auto-approve the first non-reject option (allow_once or allow_always)
3. Only cancel if no allow options are available

This allows autonomous steps to complete file operations while maintaining permission visibility through logging.

## Verification

- TypeScript type checking: ✓ PASS
- Project build: ✓ PASS (1.92 MB bundle)
- Test suite: ✓ PASS (49 tests)

---
status: resolved
