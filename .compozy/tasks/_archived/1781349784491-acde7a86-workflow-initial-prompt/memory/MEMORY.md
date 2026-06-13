# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- Task 01 done: domain contract for the feature is in place. `runner.run` takes
  `startInbound?: InboundMessage | null` (`InboundMessage = { message; kind }`,
  `kind: "user-request" | "handoff"`, both exported from `src/domain/runner.ts`).
  `RunSnapshot.initialPrompt?` exists (conditionally serialized like `branch`).
- Task 02 done: daemon threads the prompt. `run.start` RPC params and
  `RunManager.startRun` both gained `initialPrompt?` as the LAST positional arg:
  `startRun(workflowPath, cwd, branch?, initialPrompt?)`. Task 03 (HTTP) / 04 (CLI)
  call this signature. Fresh start delivers the prompt as `user-request`; retry as
  `handoff`. `#launchRunner` now takes an `inboundKind` param (default `"handoff"`).
- Task 03 done: HTTP exposes the prompt. `initialPrompt?: z.string().optional()`
  added to `StartRunRequestSchema` and `RunDetailSchema` ONLY — deliberately NOT
  on `RunSummarySchema`/`ps` (PRD Non-Goal). `POST /runs` forwards it as the 4th
  `startRun` arg; `GET /runs/:id` maps `snap.initialPrompt`. Web types (task 05/06)
  must mirror this same present-on-detail / absent-on-summary split.
- Task 05 done: both web start surfaces send the prompt. Web `StartRunRequest`
  gained `initialPrompt?: string` (web/src/lib/api/types.ts). `StartRunForm` and
  the `WorkflowList` run dialog each have an optional `Textarea` labeled
  "Initial prompt (optional)" and shape it into the request with the same
  `...(trimmedPrompt ? { initialPrompt: trimmedPrompt } : {})` pattern as `branch`
  (trimmed; omitted when blank, keeping the no-prompt body byte-for-byte identical).
  `startRun` client forwards it automatically (spreads `req`). Task 06 (web run
  view) reads it off `RunDetail`.
- Task 06 done: web run view shows the prompt. Added `initialPrompt?` to web
  `RunDetail` (types.ts) AND to `RunDetailSchema` (client.ts) — both required.
  `RunView` renders a labeled "Initial prompt" section after the isolation block
  when present, omitted otherwise; isolation display unchanged.
- Task 07 done: TUI shows the prompt. `Tui.showInitialPrompt(prompt?)` renders it
  as the opening transcript entry using the same `> {text}` / `C.blue` form as
  typed input (`submitInput`); no-op when falsy. `_attach-loop.ts` calls it right
  after `setIsolation` and BEFORE `attachSource` so it precedes replayed backlog.
  No protocol/HTTP/CLI changes — `run.attach` `initialSnapshot` already carries the
  field. `_attach-loop.ts` stays out of unit coverage (real @opentui terminal);
  attach-flow test replicates its wiring against the Tui with the test renderer.
- Task 04 done: CLI exposes the prompt. `start --prompt <text|-|@file>`.
  `parseStartArgs` stores the RAW flag value in `StartArgs.initialPrompt`; source
  resolution (inline / `-` stdin / `@file`) happens in `commands/start.ts` via
  injectable `readStdin`/`readFile` deps, forwarded as `initialPrompt` in `run.start`
  (omitted when absent). `-` is a valid `--prompt` value (stdin sentinel), unlike
  `--branch`.

## Shared Decisions

- Kickoff framing lives in `buildKickoffPrompt` (agent-session.ts) via an
  `INBOUND_LABELS` record: `user-request → "User request for this run"`,
  `handoff → "Context from previous step"`. Do not reframe upstream (ADR-002).

## Shared Learnings

- `run-manager #launchRunner` already wraps its retry/resume inbound as
  `kind: "handoff"`. Task 02 only needs to add the fresh-start `user-request`
  path (the no-inbound `#launchRunner` call); do NOT re-touch the retry path.
- Web snapshot frames are zod-validated by `RunDetailSchema` in
  `web/src/lib/api/client.ts` before reaching the reducer; `z.object` strips
  unknown keys. Any new `RunDetail` field surfaced in the run view must be added
  to BOTH the TS type (types.ts) AND `RunDetailSchema`, or it never reaches
  `vm.snapshot`.

## Open Risks

## Handoffs
