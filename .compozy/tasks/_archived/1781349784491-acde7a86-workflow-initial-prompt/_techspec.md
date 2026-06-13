# TechSpec: Initial Prompt at Run Start

## Executive Summary

Add a single optional `initialPrompt` string and thread it end-to-end across the
three start surfaces, mirroring the existing optional `branch` field: CLI `start`
flag → daemon `run.start` RPC → HTTP `POST /runs` → `RunManager.startRun` →
`Run.create` (persisted on the snapshot) → `runner.run` (delivered to the entry
step's kickoff). The prompt reaches the first step's agent under a distinct
"User request for this run" label, achieved by adding a `kind`
(`user-request | handoff`) discriminator to the runner's entry-inbound channel so
the retry path's "Context from previous step" wording is preserved (ADR-002). The
prompt is persisted as a dedicated `initialPrompt?` snapshot field and rendered in
the run view (ADR-003).

The primary trade-off: we widen several existing signatures (`runner.run`,
`buildKickoffPrompt`, `startRun`, `#launchRunner`, the RPC/HTTP/schema types) with
one optional field and one kind enum, rather than introducing any new component or
abstraction. This keeps the feature a thin, well-trodden seam at the cost of
touching many files — accepted because every touchpoint already carries the
analogous `branch` field, so the change is mechanical and low-risk.

## System Architecture

### Component Overview

The feature adds no new components; it extends one field through the existing
start pipeline. Data flow for a fresh run started with a prompt:

```
CLI start (--prompt) ─┐
Web StartRunForm ─────┼─> POST /runs ─> run.start RPC ─> RunManager.startRun
Web WorkflowList ─────┘                                        │
                                                               ▼
                                          Run.create({ initialPrompt })  ──> RunStore.persist
                                                               │
                                                               ▼
                                   #launchRunner(..., firstStepId, prompt, "user-request")
                                                               │
                                                               ▼
                                   runner.run(stepId, prompt, "user-request")
                                                               │
                                                               ▼
                                   buildKickoffPrompt(step, prompt, "user-request")
                                                               │
                                                               ▼
                                   AgentSession kickoff → entry step's agent
```

Display path: `RunStore`/`RunManager` snapshot → `RunDetail` (HTTP `GET
/runs/:id`) → `RunView.tsx` renders the `initialPrompt` section. The TUI run view
reads the same snapshot.

External interactions: none new. The prompt is plain text carried over the
existing UDS JSON-RPC and HTTP transports.

## Implementation Design

### Core Interfaces

The entry-inbound channel gains a `kind` so the entry step's kickoff is framed
correctly. This is the primary type other components depend on:

```ts
// src/domain/runner.ts
export type EntryInboundKind = "user-request" | "handoff";

export class Runner {
  // startInbound is the message handed to the entry step. Its kind selects the
  // kickoff framing: "user-request" for a fresh start's initial prompt,
  // "handoff" for a resumed/retried step. null = no inbound (today's behavior).
  async run(
    startStepId?: StepId,
    startInbound?: { message: string; kind: EntryInboundKind } | null,
  ): Promise<RunSummary>;
}
```

```ts
// src/infra/acp/agent-session.ts
export function buildKickoffPrompt(
  step: Step,
  inbound: { message: string; kind: EntryInboundKind } | null,
): string;
// kind "user-request" -> "User request for this run: {message}"
// kind "handoff"      -> "Context from previous step: {message}"  (unchanged)
```

Inter-step handoffs inside the runner loop continue to build a `handoff`-kind
inbound for the next step, so no behavior changes between steps.

### Data Models

`initialPrompt` is added as an optional field everywhere `branch` already appears.

```ts
// src/domain/run.ts — RunSnapshot
export interface RunSnapshot {
  // ...existing fields (workflowPath, cwd?, worktreePath?, branch?, ...)
  initialPrompt?: string; // present only when the run was started with a prompt
}
```

- `Run.create` accepts `initialPrompt?` and stores it; `snapshot()` serializes it
  only when present (same conditional style as `branch`/`cwd`).
- `RunStore` persists it transparently (it round-trips the whole snapshot).
- API schema (`src/app/api/schema.ts`): add `initialPrompt: z.string().optional()`
  to `RunDetailSchema` (and `RunSummarySchema` only if needed by the run view;
  excluded from the compact `ps` projection per PRD Non-Goal).

CLI args:

```ts
// src/app/cli.ts — StartArgs
export interface StartArgs {
  workflowPath: string;
  detach: boolean;
  branch?: string;
  initialPrompt?: string; // resolved value (inline, stdin, or file contents)
}
```

Web request type (`web/src/lib/api/types.ts`): add `initialPrompt?: string` to
`StartRunRequest`.

### API Endpoints

| Method | Path | Change |
|--------|------|--------|
| POST | `/runs` | Request body gains optional `initialPrompt: string`. 201/400/429 responses unchanged. |
| RPC | `run.start` | `params` gains optional `initialPrompt?: string`; result unchanged. |
| GET | `/runs/:id` | `RunDetail` response gains optional `initialPrompt`. |

`POST /runs` body (additive, optional):

```jsonc
{ "workflowPath": "...", "cwd": "...", "branch": "feature/x", "initialPrompt": "review PR #42" }
```

An omitted/blank `initialPrompt` is dropped before the call (mirroring the
`...(branch !== undefined ? { branch } : {})` shaping), keeping the no-prompt path
byte-for-byte identical to today.

## Integration Points

None outside the codebase. The prompt is plain text over existing transports.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|---------------------|-----------------|
| `src/domain/runner.ts` | modified | Entry-inbound channel gains `{ message, kind }`; loop builds `handoff` kind for next steps. Low risk; covered by existing runner tests. | Update `run` signature + call sites; add kind to inter-step inbound. |
| `src/infra/acp/agent-session.ts` | modified | `buildKickoffPrompt` selects label by kind. Low risk. | Add kind param + label switch. |
| `src/domain/run.ts` | modified | `RunSnapshot.initialPrompt?`, `Run.create` arg, conditional serialize. Low risk; mirrors `branch`. | Add field through constructor/create/snapshot. |
| `src/infra/daemon/run-manager.ts` | modified | `startRun(..., initialPrompt?)`; pass to `Run.create` and `#launchRunner(... , "user-request")`; `retryStep` passes `"handoff"`. Medium risk (two launch paths). | Thread arg; set correct kind per path. |
| `src/infra/daemon/handlers/run-start.ts` | modified | Forward `params.initialPrompt`. Low risk. | One-line pass-through. |
| `src/infra/daemon/protocol.ts` | modified | `run.start` params type. Low risk. | Add optional field. |
| `src/app/api/schema.ts` | modified | `StartRunRequestSchema` + `RunDetailSchema` gain field. Low risk. | Add zod optional fields. |
| `src/app/api/routes/start-run.ts` | modified | Read `initialPrompt` from validated body; pass to `startRun`. Low risk. | Destructure + forward. |
| `src/app/api/routes/run-detail.ts` | modified | Surface `initialPrompt` in `RunDetail` projection. Low risk. | Map field from snapshot. |
| `src/app/cli.ts` | modified | `parseStartArgs` handles `--prompt`, `--prompt=`, `--prompt -`, `--prompt @file`; `StartArgs` + `USAGE.start`. Medium risk (arg parsing edge cases). | Add flag parsing + usage text. |
| `src/app/commands/start.ts` | modified | Resolve prompt source (inline/stdin/file) via injectable readers; pass to RPC. Medium risk (I/O). | Resolve value; forward in `run.start`. |
| `web/src/lib/api/types.ts` | modified | `StartRunRequest.initialPrompt?`. Low risk. | Add field. |
| `web/src/features/start-run/StartRunForm.tsx` | modified | Optional multi-line prompt field (Textarea). Low risk. | Add field + request shaping. |
| `web/src/features/workflows/WorkflowList.tsx` | modified | Optional prompt Textarea in the existing run dialog. Low risk. | Add field to dialog + mutation. |
| `web/src/features/run-view/RunView.tsx` | modified | Render `initialPrompt` section when present. Low risk. | Add display block. |
| `web/src/components/ui/textarea.tsx` | new (if absent) | shadcn `textarea` primitive. Low risk. | `bunx --bun shadcn@latest add textarea` if not present. |

## Testing Approach

### Unit Tests

- **`runner.test.ts`** — entry step with `{ kind: "user-request" }` produces a
  "User request for this run" kickoff; with `{ kind: "handoff" }` (retry)
  produces "Context from previous step"; `null` inbound is unchanged. Inter-step
  handoff still frames as `handoff`.
- **`agent-session` / `buildKickoffPrompt`** — label selection per kind; null
  inbound yields today's exact string.
- **`run.test.ts`** — `initialPrompt` round-trips through `create` → `snapshot` →
  `fromSnapshot`; omitted when absent.
- **`cli.test.ts` (`parseStartArgs`)** — `--prompt "x"`, `--prompt=x`,
  `--prompt -` (stdin sentinel), `--prompt @file` (file sentinel), missing value
  error, interaction with `--branch`/`-d`.
- **`commands/start.test.ts`** — resolves inline vs stdin (injected
  `readStdin`) vs file (injected reader); forwards `initialPrompt` in `run.start`;
  omits it when not supplied.
- **API schema / `start-run` route** — accepts and forwards `initialPrompt`;
  `run-detail` route exposes it.
- **Web (vitest)** — `StartRunForm` and `WorkflowList` submit `initialPrompt`
  when filled and omit it when blank; `RunView` shows the prompt section when
  present and hides it when absent.

Mock boundaries: CLI stdin/file readers injected via existing `deps` pattern
(as `send` does with `readStdin`); web API calls mocked at the `startRun` client.

### Integration Tests

- **`run-manager`** integration — `startRun` with `initialPrompt` persists it on
  the snapshot and the entry step's recorded kickoff reflects the user-request
  framing; `retryStep` still frames as handoff. Reuse the existing fixture session
  factory.
- No new environment dependencies; the manual E2E in `README.md` gains a note that
  `start --prompt` directs the first agent.

## Development Sequencing

### Build Order

1. **Domain: `RunSnapshot.initialPrompt` + entry-inbound `kind`** — no
   dependencies. Add the field to `run.ts` (create/constructor/snapshot) and the
   `EntryInboundKind` type + `{message, kind}` channel to `runner.ts`, plus the
   `buildKickoffPrompt` label switch in `agent-session.ts`.
2. **Daemon wiring** — depends on step 1. `startRun(..., initialPrompt?)` →
   `Run.create` + `#launchRunner(..., "user-request")`; `retryStep` →
   `"handoff"`; `run.start` protocol type; `run-start` handler pass-through.
3. **HTTP API** — depends on step 2. `StartRunRequestSchema` + `RunDetailSchema`
   fields; `start-run` and `run-detail` routes forward/expose the field.
4. **CLI** — depends on step 2 (RPC param exists). `parseStartArgs` flag handling,
   `StartArgs`, `USAGE.start`; `commands/start.ts` source resolution
   (inline/stdin/file) and forwarding.
5. **Web client + forms** — depends on step 3. `StartRunRequest` type; prompt
   field in `StartRunForm` and `WorkflowList` run dialog (add shadcn `textarea`
   first if missing).
6. **Web run view** — depends on steps 3 and 5. `RunView` renders the
   `initialPrompt` section from `RunDetail`.
7. **Tests across all layers** — depends on the steps they cover; land alongside
   each step, with the integration test after step 2.

### Technical Dependencies

- shadcn `textarea` primitive must exist in `web/src/components/ui/` (install via
  CLI per CLAUDE.md if absent). No other blocking dependencies.

## Monitoring and Observability

No new metrics or alerts. The entry-step kickoff is already recorded in the run's
`kickoffPrompts` and event log; the persisted `initialPrompt` field makes the
start-time input independently inspectable in the run store and `GET /runs/:id`.

## Technical Considerations

### Key Decisions

- **Decision:** Add a `kind` discriminator to the entry-inbound channel rather
  than a separate `initialPrompt` runner parameter or upstream pre-framing.
  **Rationale:** one labeled channel expresses the mutually-exclusive origins
  (fresh prompt vs retry handoff) while keeping kickoff framing in the domain.
  **Trade-off:** widens `run`/`buildKickoffPrompt` signatures. **Alternatives:**
  separate parameter (two channels to reconcile), upstream framing (layer leak).
  See ADR-002.
- **Decision:** Dedicated optional `initialPrompt` snapshot field for persistence
  and display. **Rationale:** clean raw text without parsing kickoff blobs; reuses
  the `branch` pattern. **Trade-off:** one more optional field. **Alternatives:**
  derive from `kickoffPrompts` (couples UI to kickoff wording), event-log only
  (lost on truncation). See ADR-003.
- **Decision:** CLI `--prompt` with `-` (stdin) and `@file` modes. **Rationale:**
  one flag covers short and long prompts; `-` mirrors `send`'s convention.
  **Trade-off:** slightly more arg-parsing logic vs. inline-only.

### Known Risks

- **Arg-parsing edge cases** (`--prompt @file` vs a literal prompt beginning with
  `@`, or `-` as literal text). Likelihood: medium. Mitigation: explicit sentinel
  rules (`-` = stdin, leading `@` = file) documented in usage and covered by
  `parseStartArgs` tests; inline text needing a literal leading `@`/`-` can use
  stdin.
- **Two launch paths set the wrong kind** (fresh start vs retry). Likelihood: low.
  Mitigation: integration test asserting framing per path.
- **Backward compatibility** of persisted snapshots. Likelihood: low. Mitigation:
  field is optional and conditionally serialized; absent on existing runs.

## Architecture Decision Records

- [ADR-001: Unified optional initial prompt across all run-start surfaces](adrs/adr-001.md)
  — Deliver one optional free-text prompt across CLI and both web surfaces in a
  single release, persisted and shown in the run view (from the PRD).
- [ADR-002: Inbound-message kind discriminator for kickoff framing](adrs/adr-002.md)
  — Carry a `user-request | handoff` kind on the entry-inbound channel so the
  initial prompt frames as a user request without disturbing the retry path.
- [ADR-003: Dedicated `initialPrompt` field on the run snapshot](adrs/adr-003.md)
  — Persist the prompt as its own optional snapshot field (mirroring `branch`) and
  render it in the run view, rather than deriving it from step kickoffs.
