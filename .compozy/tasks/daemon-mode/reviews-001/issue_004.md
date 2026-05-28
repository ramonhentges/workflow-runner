---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/handlers/run-start.ts
line: 15
severity: high
author: claude-code
provider_ref:
---

# Issue 004: run.start collapses every non-RunManagerError into WORKFLOW_INVALID

## Review Comment

`createRunStartHandler` catches any error from `rm.startRun`, and unless it is
a `RunManagerError` it raises `RpcError(WORKFLOW_INVALID, ...)`. But
`RunManager.startRun` calls `Workflow.load`, `EventLog.open`,
`this.#createMcpServer()`, and `this.#store.persist(...)` — all of which can
throw for reasons that are not "the workflow JSON is invalid": disk full,
permission denied on the storage root, ephemeral-port exhaustion when starting
the MCP server, etc. Surfacing these as `WORKFLOW_INVALID` confuses
diagnostics: `start.ts:73` shows the user "workflow invalid: EACCES …"
when the workflow file itself is fine.

Suggested fix: only re-raise `WORKFLOW_INVALID` when the failure originated in
workflow parsing/validation. Have `Workflow.load` (or a wrapper) throw a
typed `WorkflowValidationError`, and treat everything else as
`-32603 Internal error` with the underlying message in `data`.

```typescript
} catch (e) {
  if (e instanceof RunManagerError) {
    throw new RpcError(e.code, e.message, e.data);
  }
  if (e instanceof WorkflowValidationError) {
    throw new RpcError(RpcErrorCode.WORKFLOW_INVALID, e.message);
  }
  throw e; // let RpcServer render -32603 with detail.
}
```

## Triage

- Decision: `valid`
- Notes: `RunManager.startRun` can fail at `this.#store.persist()`, `EventLog.open()`, or `this.#createMcpServer()` with raw OS errors (EACCES, ENOSPC, EADDRINUSE) that are unrelated to workflow validity. The current catch block maps all of these to `WORKFLOW_INVALID`, giving misleading diagnostics. The domain already has `WorkflowConfigError` for workflow parsing/validation failures — the fix is to check `instanceof WorkflowConfigError` for `WORKFLOW_INVALID`, and re-throw everything else so `RpcServer` renders it as `-32603 Internal error`.
