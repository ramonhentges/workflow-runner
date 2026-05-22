---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/runner.test.ts
line: 175
severity: medium
author: claude-code
provider_ref:
---

# Issue 011: Vacuous tests; no coverage of the orchestration loop

## Review Comment

`runner.test.ts` covers only `formatRunSummary` (a pure function). The
"Step outcome classification" describe block (lines 175-195) tests nothing about
the implementation — each case declares a hardcoded string literal and asserts
that the literal contains its own substrings:

```ts
const reason = "Subprocess exited with code 127";
expect(reason).toContain("Subprocess exited");
expect(reason).toContain("code 127");
```

These always pass regardless of any code change and give a false sense of
coverage. Meanwhile the genuinely risky logic — `runWorkflow`'s step loop, the
outcome-vs-exit race, handoff-message threading (issue 004), the autonomous
"completed without a tool call" failure path, and `setupStepSession` — has no
unit coverage at all.

Suggested fix: delete the "Step outcome classification" block. Add real tests
for the orchestration loop by injecting fakes — a stub `WorkflowMcpServer` whose
`beginStep` lets the test drive outcomes, and a fake `RunnerUi` that records
calls — so `runWorkflow` can be exercised for handoff chains, finish, invalid
targets, and failure handling without spawning `opencode`. The TechSpec accepts
manual E2E for the live ACP path, but the pure orchestration logic should be
covered.

## Triage

- Decision: `VALID`
- Root cause: The "Step outcome classification" block (lines 175-195) contains vacuous tests that assert hardcoded string literals against themselves. These tests always pass regardless of implementation changes and provide no real coverage of the orchestration logic.
- Issue severity: The tests give false confidence that error classification is working when there's actually no validation of the error path logic. Critical business logic like `runWorkflow`'s step loop, the outcome-vs-exit race, and autonomous step failures are untested.
- Implementation completed: 
  1. **Vacuous tests deleted**: Removed the "Step outcome classification" block (lines 175-195)
  2. **Orchestration tests added**: Refactored `RunOptions` to accept `_testSessionFactory` for dependency injection, enabling unit tests without spawning opencode
  3. **New test coverage**: Added 7 orchestration tests covering:
     - Single-step workflow with finish outcome
     - Handoff chain across multiple steps
     - Invalid starting step detection
     - Invalid handoff target detection
     - Failure outcome propagation
     - Inbound message preservation through handoff chain
     - Subprocess exit race condition handling
  4. **Verification**: All 53 tests pass, TypeScript type checking passes
- Impact: The orchestration logic now has real unit coverage driven by stub MCP servers and mock sessions, verifying the core step loop, outcome routing, and failure handling as suggested by the review.
