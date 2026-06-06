---
provider: manual
pr:
round: 2
round_created_at: 2026-06-05T13:46:17Z
status: resolved
file: src/app/api/routes/workflow-run-guard.ts
line: 15
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Run guard uses raw path equality, misses non-canonical run paths

## Review Comment

The run-aware delete/rename guard is the implementation of PRD Core Feature #7
("never let a delete or identity-changing edit break a run that is currently
executing") and the success metric "zero active runs disrupted." It compares the
stored run path against the target file with raw string equality:

```ts
if (snap.status === "running" && snap.workflowPath === workflowPath) {
  return snap.id;
}
```

The call sites in `workflow-crud.ts` (delete `:316/323`, rename `:265/275`) pass
`file = resolveWorkflowFile(cwd, name)`, which is always an **absolute, resolved**
path (`<cwd>/workflows/<name>.json`). But `snap.workflowPath` is stored verbatim
from whatever started the run — `RunManager.startRun` passes it straight into
`Run.create` with no normalization (`run-manager.ts:154`), and `Workflow.load`
reads the path as-is. The CLI start path (`workflow-runner start
workflows/who-is.json`, documented in CLAUDE.md) stores a **relative** path, so
`"workflows/who-is.json" === "/abs/cwd/workflows/who-is.json"` is `false`.

Result: a run started outside the web flow (or with any non-canonical spelling —
relative, `./`, trailing differences) is **not detected**, so a web `DELETE`
returns `200 { deleted }` and `fs.unlink`s the file while the run is live. This
is exactly the disruption the guard exists to prevent. It also bites on retry:
`RunManager.retryStep` reloads from disk via `Workflow.load(snap.workflowPath)`
(`run-manager.ts:258`), which then fails because the file is gone. The daemon is
shared between CLI and web, so CLI-start + web-delete is a realistic path, not a
theoretical one.

Suggested fix: normalize both sides before comparing. `RunSnapshot` carries
`cwd`, so resolve the stored path against it inside the guard:

```ts
import { resolve } from "node:path";
// ...
const snapFile = resolve(snap.cwd ?? "", snap.workflowPath);
if (snap.status === "running" && snapFile === workflowPath) {
  return snap.id;
}
```

(Absolute comparison stays correct across projects — two projects' `workflows/x.json`
resolve to different absolute paths, so this introduces no false positives.) Add
a guard test where a run is started with a relative `workflowPath` and the
delete/rename is still blocked.

## Triage

- Decision: `VALID`
- Root cause: `findActiveRunForWorkflow` compared `snap.workflowPath` against the
  target with raw string equality. Confirmed the CLI `start` command
  (`src/app/commands/start.ts:50`) passes `workflowPath` exactly as the user
  typed it (a relative path such as `workflows/who-is.json`) together with an
  absolute `cwd: process.cwd()`. `RunManager.startRun`
  (`src/infra/daemon/run-manager.ts:154`) stores that path verbatim via
  `Run.create` with no normalization. The CRUD guard call sites
  (`workflow-crud.ts:275`/`:323`) always pass the absolute, resolved
  `resolveWorkflowFile(cwd, name)`. So a CLI-started run with a relative path
  was never detected, letting a web DELETE/rename `fs.unlink` or move a file out
  from under a live run — exactly the disruption PRD Core Feature #7 exists to
  prevent.
- Fix: `RunSnapshot` already carries `cwd` (`src/domain/run.ts:20`). The guard now
  resolves the stored path against its `cwd` (`resolve(snap.cwd ?? "",
  snap.workflowPath)`) before comparing, so both sides are absolute. Absolute
  paths pass through `resolve` unchanged, so previously-correct absolute matches
  are unaffected; two projects' `workflows/x.json` resolve to distinct absolute
  paths, so no false positives are introduced.
- Tests: added unit cases in `workflow-run-guard.test.ts` covering a run stored
  with a relative path (blocked against the cwd-resolved target), a
  `./`-prefixed relative path, and a relative path under a different cwd (not
  matched). `makeSnap` gained an optional `cwd` field.
- Verification: `bun run typecheck` clean; `bun test` → 935 pass / 1 skip /
  0 fail (15 pass in the guard test file); `bun run build` succeeds.
