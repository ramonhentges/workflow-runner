---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/handlers/run-retry-step.ts
line: 14
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: run.retryStep returns Internal error for invalid workflow JSON

## Review Comment

`RunManager.retryStep` calls `await Workflow.load(snap.workflowPath)` at
`run-manager.ts:238`. If the user edited the workflow JSON between the initial
`start` and the `retryStep` and broke it, `Workflow.load` throws
`WorkflowConfigError`. The handler at `run-retry-step.ts:13–20` only translates
`RunManagerError`; every other error falls through to RpcServer's generic
`-32603 "Internal error"`. The CLI then prints "Internal error: …", which is
neither actionable nor in the documented error vocabulary.

`run-start.ts:15–17` already maps this case to `WORKFLOW_INVALID` for the
parallel `run.start` path; `run.retryStep` should do the same:

```ts
} catch (e) {
  if (e instanceof RunManagerError) {
    throw new RpcError(e.code, e.message, e.data);
  }
  if (e instanceof WorkflowConfigError) {
    throw new RpcError(RpcErrorCode.WORKFLOW_INVALID, e.message);
  }
  throw e;
}
```

Round 1's issue 004 fixed the same class of bug for `run.start`; this is the
same gap on the retry path. Add a handler test that throws
`WorkflowConfigError` from a fake `RunManager.retryStep` and asserts the
emitted error code.

## Triage

- Decision: `valid`
- Root cause: `createRunRetryStepHandler` only catches and translates `RunManagerError`, allowing `WorkflowConfigError` to bubble up as a generic `-32603 "Internal error"`. This is inconsistent with `createRunStartHandler` which explicitly catches `WorkflowConfigError` and maps it to `WORKFLOW_INVALID`.
- Intended fix: Add a catch block in `run-retry-step.ts` lines 13–20 that checks for `WorkflowConfigError` (after checking `RunManagerError`) and throws `RpcError(RpcErrorCode.WORKFLOW_INVALID, e.message)`. Also add a test case to `handlers.test.ts` that verifies this error mapping.
