---
provider: manual
pr:
round: 1
round_created_at: 2026-06-12T14:08:41Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 157
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Blank initialPrompt is not normalized server-side, deviating from the "byte-for-byte" no-prompt guarantee

## Review Comment

The PRD and TechSpec state repeatedly that a **blank or omitted** prompt must be
indistinguishable from today's behavior ("A blank or omitted prompt is
indistinguishable from today's behavior"; Success Metric: "Runs started without a
prompt remain byte-for-byte equivalent to today's behavior"). The TechSpec's plan
is that "an omitted/blank `initialPrompt` is dropped before the call (mirroring
the `...(branch !== undefined ? { branch } : {})` shaping)". The web surfaces honor
this — both `StartRunForm.tsx` and `WorkflowList.tsx` trim and drop an empty
prompt. The CLI and the server do not, so an empty/whitespace prompt is reachable
and breaks the guarantee.

Concretely, with a blank value the prompt is **not** dropped:

- `src/app/cli.ts:83-92` — the space-separated form `--prompt ""` accepts an empty
  string (`"".startsWith("-")` is false), and `--prompt "   "` accepts
  whitespace. This is also internally inconsistent with the `--prompt=` form at
  `cli.ts:94-102`, which explicitly rejects an empty value.
- `src/app/commands/start.ts` — `resolvePrompt` forwards `""` verbatim for
  `--prompt ""`, an empty file (`--prompt @empty.txt`), or empty/whitespace stdin
  (`printf '' | start --prompt -`). It then sends `initialPrompt: ""` because the
  guard is `initialPrompt !== undefined`, not "non-empty".
- `src/app/api/schema.ts` — `StartRunRequestSchema.initialPrompt` is bare
  `z.string().optional()`, unlike the sibling `branch: z.string().trim().min(1).optional()`
  one line above, so there is no server-side backstop. (Note the CLI path goes
  through the `run.start` RPC and bypasses this zod schema entirely.)
- `src/infra/daemon/run-manager.ts:157` — `startRun` passes the value straight to
  `Run.create` and `#launchRunner(..., initialPrompt ?? null, "user-request")`.

The observable effect of an empty/whitespace prompt:
1. It is persisted on the snapshot — `Run.snapshot()` serializes it because
   `"" !== undefined` (`src/domain/run.ts:122-124`).
2. The entry step's kickoff gains a degenerate `"User request for this run: "`
   line (`#launchRunner` builds `{ message: "", kind: "user-request" }` since
   `"" != null`, and `buildKickoffPrompt`'s `if (inbound)` is truthy for the
   object). This is *not* byte-for-byte identical to the no-prompt kickoff.

Suggested fix: normalize blank to "absent" at the single server chokepoint that
both the HTTP and RPC paths funnel through — `RunManager.startRun` — e.g.
`const prompt = initialPrompt?.trim() || undefined;` and thread `prompt` onward.
Optionally also tighten `cli.ts` so the space form rejects empty like the `=`
form does, and mirror `branch` in `schema.ts` (`z.string().trim().min(1).optional()`)
as defense-in-depth. Add a test asserting that a blank prompt produces a snapshot
with no `initialPrompt` and a kickoff identical to the no-prompt path.

## Triage

- Decision: `VALID`
- Root cause: A blank/whitespace `initialPrompt` had no server-side
  normalization. Both entry paths converge on `RunManager.startRun`
  (HTTP route → `run.start` handler → `startRun`; CLI → `run.start` RPC →
  `startRun`), but `startRun` passed the raw value straight to `Run.create`
  and `#launchRunner`. Because the guards are `!== undefined` (`Run.snapshot`)
  and `!= null` (`#launchRunner` building the inbound), an empty string `""`
  was persisted on the snapshot and produced a degenerate
  `"User request for this run: "` kickoff line — not byte-for-byte equivalent
  to the no-prompt path required by the PRD/TechSpec (ADR-003).
- Fix: Normalize at the single shared chokepoint. Added
  `const prompt = initialPrompt?.trim() || undefined;` at the top of
  `startRun` and threaded `prompt` into both `Run.create({ ..., initialPrompt:
  prompt })` and `#launchRunner(..., prompt ?? null, "user-request")`. This
  mirrors what the web surfaces (`StartRunForm.tsx`, `WorkflowList.tsx`)
  already do (trim-and-drop), so HTTP, RPC, and CLI now agree. A non-blank
  prompt is unaffected beyond the same trim the web already applies.
- Scope note: The batch scope lists only `src/infra/daemon/run-manager.ts` as
  in-scope code. The optional defense-in-depth tweaks suggested in the review
  (tightening the `--prompt` space-form in `cli.ts` and mirroring `branch` in
  `schema.ts`) touch files outside this batch and are not required for the
  guarantee — the `startRun` chokepoint already closes every reachable path —
  so they were intentionally left out to keep the change constrained.
- Test: Added "normalizes a blank/whitespace prompt to the no-prompt path" in
  `run-manager.integration.test.ts`, asserting a whitespace-only prompt yields
  a snapshot with no `initialPrompt`, a `null` inbound, a kickoff without the
  "User request for this run" line, and a store round-trip without the field.
