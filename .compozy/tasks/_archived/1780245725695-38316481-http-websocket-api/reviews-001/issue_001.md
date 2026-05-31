---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 155
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Start `cwd` is accepted without existence/absoluteness validation

## Review Comment

`POST /runs` requires `cwd` and threads it straight into the runner:

```ts
// src/infra/daemon/run-manager.ts (startRun)
const runner = new Runner(workflow, this.sessionFactory, this.mcp, {
  cwd,
  onStepBoundary: (stepId) => eventLog.recordStepBoundary(stepId),
});
```

The Zod schema (`StartRunRequestSchema`) only enforces `z.string().min(1)`, and
neither `run-manager.ts` nor `src/infra/daemon/handlers/run-start.ts` validates
that the path exists or is absolute (confirmed: no `existsSync`/`statSync`/
`isAbsolute`/`access` call on either path).

Why this matters for this feature specifically:

- ADR-002 makes `cwd` a deliberate first-class input *because* "an HTTP caller
  has no ambient shell; silently using the daemon's cwd is a footgun." A
  relative `cwd` reintroduces exactly that footgun — it would resolve against the
  daemon process's cwd, not the caller's intent.
- A non-existent directory fails opaquely deep inside agent subprocess spawn
  (well after `201 Created` has been returned with a `runId`), so the UI sees a
  successfully-created run that immediately crashes with an unclear error rather
  than a clean `400` at submit time.
- The PRD/TechSpec flag the spawn path as a confused-deputy surface; a boundary
  check (absolute + directory exists) is cheap defense-in-depth.

Suggested fix: validate `cwd` at the API boundary (or in `startRun`) — require an
absolute path and assert it resolves to an existing directory — returning `400
WORKFLOW_INVALID` (or a dedicated code) before the run is created. Keep the CLI
path working since it already sends `process.cwd()` (absolute).

## Triage

- Decision: `valid`
- Notes: Confirmed that `startRun()` in `run-manager.ts` accepts any non-empty string for `cwd` with no absoluteness or existence check. The `StartRunRequestSchema` in `schema.ts` only enforces `z.string().min(1)`. The CLI sends `process.cwd()` which is always absolute, but an HTTP caller can send any string. Root cause: no boundary validation at the `startRun` entry point. Fix: add `isAbsolute` check and `statSync` existence+directory check at the top of `startRun()`, throwing a new `CWD_INVALID` RunManagerError before any run state is created. Adding `CWD_INVALID: -32007` as a dedicated error code in `RpcErrorCode` and mapping it to HTTP 400 in `error-map.ts`.
