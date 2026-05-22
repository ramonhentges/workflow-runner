---
provider: manual
pr:
round: 2
round_created_at: 2026-05-22T20:26:37Z
status: resolved
file: src/runner.ts
line: 188
severity: high
author: claude-code
provider_ref:
---

# Issue 003: Spawned opencode subprocess has no error listener

## Review Comment

`setupStepSession` spawns the agent with no `error` listener on the child
process:

```ts
const agentProcess = spawn("opencode", ["acp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...globalThis.process.env, OPENCODE_ENABLE_QUESTION_TOOL: "1" },
});
// only stderr "data" and (later, in runWorkflow) "exit" are listened for
```

When `spawn` cannot launch the binary — `opencode` not on `PATH`, not
executable, etc. — Node reports the failure by emitting an `'error'` event on
the `ChildProcess`. An `'error'` event with no listener is re-thrown by the
EventEmitter as an uncaught exception. It is *not* a promise rejection, so the
`try/catch` around `sessionFactory(...)` in `runWorkflow` does not catch it, and
neither does `main().catch(...)`. The runner crashes with a raw
`Error: spawn opencode ENOENT` stack trace — over a `@opentui/core` TUI that is
mid-render — instead of the clear, actionable message the PRD ("a clear error
when a step fails") and the TechSpec (fail-fast on a missing `opencode`)
require. A missing/misconfigured `opencode` is a guaranteed first-run failure
mode, so this path will be hit.

Note `spawn` failure emits only `'error'`, never `'exit'`, so the
subprocess-exit race in `runWorkflow` also never fires for this case.

The same omission exists for the init subprocess in `src/index.ts` (line 423) —
its `spawn("opencode", ["acp"], ...)` likewise has no `'error'` listener.

Suggested fix: attach an `'error'` handler to every spawned `ChildProcess`.
In `setupStepSession`, reject the step setup (turning it into a clean step
failure with a message naming `opencode`); in `index.ts`, surface it through the
TUI status/log and set a non-zero exit code. Consider checking the binary is
resolvable up front and failing before the TUI is constructed.

## Triage

- Decision: `VALID`
- Root cause: The spawned `ChildProcess` from `spawn("opencode", ["acp"], ...)` has no error event listener. When spawn fails (ENOENT, EACCES, etc.), Node emits an uncaught 'error' event that crashes the process instead of being caught by the try/catch in `runWorkflow` or the error handler in `index.ts`.
- Fix approach: Attach 'error' event handlers to both spawned processes:
  - In `runner.ts` setupStepSession: reject the outcome promise with a clear error message naming opencode
  - In `index.ts`: surface the error through the TUI and set a non-zero exit code
