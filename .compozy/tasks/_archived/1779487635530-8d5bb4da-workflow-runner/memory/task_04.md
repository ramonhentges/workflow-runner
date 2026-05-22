# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `src/runner.ts` to orchestrate multi-step workflow execution. Core responsibilities: spawn subprocess per step, initialize ACP session with HTTP MCP verification, bind mode/model, handle interactive vs autonomous modes, detect three failure modes, build RunSummary.

## Important Decisions

- **Process variable shadowing:** Used `agentProcess` instead of `process` to avoid shadowing global Node.js process object. This is standard practice to keep code clear.
- **Outcome promise race condition:** For autonomous steps, race the kickoff prompt completion against the MCP outcome promise. Prompt completion without outcome = failure. This is the robust pattern for detecting "autonomous step without handoff/finish".
- **setupStepSession returns early for interactive mode:** Interactive mode sends the kickoff prompt and then returns the session with the pending outcome promise. The top-level runWorkflow loop then never actually drives further turns (the current runner doesn't implement interactive input routing yet—that's Task 5's job).

## Learnings

- InitializeResult type is not exported from @agentclientprotocol/sdk; use `any` cast on agentCapabilities access until the SDK exports proper types.
- The MCP server's `beginStep()` synchronously sets `currentStep` and `currentResolve`, so the outcome promise from `mcp.beginStep(step, resolve)` is truly async and fires when a tool is called.
- All 13 unit tests for formatRunSummary + failure classification pass; 36 total tests pass (workflow.test.ts + mcp.test.ts + runner.test.ts).

## Files / Surfaces

- **Created:** `src/runner.ts` (404 lines) — exports runWorkflow, RunOptions, RunSummary, RunnerUi, formatRunSummary
- **Created:** `src/runner.test.ts` (180 lines) — 13 tests covering summary formatting and failure classification
- **Modified indirectly:** None yet (index.ts rewrite is Task 5; mcp.ts/workflow.ts unchanged)

## Errors / Corrections

- **TypeError: InitializeResult not exported** — removed incorrect import, used `(initResult as any).agentCapabilities`
- **ReferenceError: process used before declaration** — changed subprocess spawn to use `agentProcess` name instead of shadowing global `process`

## Ready for Next Run

- `src/runner.ts` fully implements steps 4.1–4.6 (core orchestration, failure detection, summary)
- `src/runner.test.ts` covers pure logic (formatRunSummary, failure classification); 13/13 pass
- All tests passing (`bun test` = 36 pass, 0 fail)
- TypeCheck: 0 errors
- Next task (Task 5) must implement `index.ts` rewrite with RunnerUi and interactive input routing
