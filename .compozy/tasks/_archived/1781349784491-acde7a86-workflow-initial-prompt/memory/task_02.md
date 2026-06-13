# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Thread optional `initialPrompt` from `run.start` RPC into `RunManager.startRun` →
`Run.create` (persisted) and deliver to the entry step as `kind: "user-request"`;
retry path delivers as `kind: "handoff"`. Done.

## Important Decisions

- `#launchRunner` gained a 5th param `inboundKind: EntryInboundKind = "handoff"`.
  Default kept "handoff" so behavior is unchanged for callers not passing it; the
  fresh-start call passes `"user-request"`, the retry call passes `"handoff"`
  explicitly (equals default, but explicit per subtask 2.4). The previously
  hardcoded `kind: "handoff" as const` inside `#launchRunner` became `inboundKind`.

## Learnings

- No-prompt fresh start stays byte-for-byte identical: `initialPrompt ?? null`
  yields a null `startInbound`, so the entry kickoff appends no label.
- Integration tests use `FakeSessionFactory`'s `onCreate` to capture `args.inbound`
  (the `{message, kind}` the entry step receives). The framing label is verified
  by feeding that captured inbound through `buildKickoffPrompt(step, inbound)` from
  agent-session — the canonical producer of the "User request for this run" /
  "Context from previous step" labels.
- Prompt-only integration tests need no git: passing `branch=undefined` skips all
  worktree logic, so a plain `mkdtemp` cwd suffices (own describe block, separate
  from the real-git worktree suite).
- `run-manager.ts` full-file func coverage reads ~78% but the new threading lines
  are 100% covered; the gap is pre-existing untested methods (stop/sendInput/etc).

## Files / Surfaces

- `src/infra/daemon/protocol.ts` — `run.start.params` gained `initialPrompt?`.
- `src/infra/daemon/handlers/run-start.ts` — forwards `params.initialPrompt`.
- `src/infra/daemon/run-manager.ts` — `startRun(.., initialPrompt?)`, `Run.create`
  arg, fresh-start `#launchRunner(.., initialPrompt ?? null, "user-request")`,
  retry `#launchRunner(.., "handoff")`, `#launchRunner` `inboundKind` param.
- Tests: `handlers.test.ts` (forward/omit prompt), `run-manager.integration.test.ts`
  (new "RunManager initialPrompt threading" describe block).

## Errors / Corrections

- None.

## Ready for Next Run

- Task 03 (HTTP API) calls `startRun(.., branch?, initialPrompt?)` — signature is
  positional: `(workflowPath, cwd, branch?, initialPrompt?)`.
- Pre-existing flaky test: `api-listener.test.ts` p95-latency budget (5 ms) can
  fail under full-suite load (saw 5.0006 ms); passes in isolation. Not ours.
