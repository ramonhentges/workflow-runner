# Start Workflow from Step Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: activate it by name and follow its Execute flow and Critical Rules. Tests derive from the specification, every gate must pass, and every task receives one atomic commit.

**Design**: `.specs/features/start-workflow-from-step/design.md`
**Status**: Done — pending standalone verifier

**Task status**: T1 ✅ `fcc2815`; T2 ✅ `f932a55`; T3 ✅ `69c1036`; T4 ✅ `0ca1895`; T5 ✅ `04e3e09`; T6 ✅ `741c193`; T7 ✅ `a04ef79`; T8 ✅ documentation/final gate commit.

---

## Test Coverage Matrix

> Generated from `CLAUDE.md`, `README.md`, `package.json`, `web/package.json`, existing Bun/Vitest tests, and the spec. No numeric coverage threshold is documented; strong defaults apply.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Run orchestration/service | unit + integration | Exact selected/default entry, prompt framing, invalid-step pre-mutation behavior, and graph edge cases | `src/infra/daemon/run-manager.test.ts` | `bun test src/infra/daemon/run-manager.test.ts` |
| RPC adapter | unit | Exact optional-field forwarding, omission compatibility, workflow-error mapping | `src/infra/daemon/handlers/handlers.test.ts` | `bun test src/infra/daemon/handlers/handlers.test.ts` |
| HTTP schema/route | route integration | Valid field, omission, invalid shape, and `WORKFLOW_INVALID` response | `src/app/api/routes/start-run.test.ts`, `src/app/api/schema.test.ts` | `bun test src/app/api/routes/start-run.test.ts src/app/api/schema.test.ts` |
| CLI/TUI launch adapter | unit | Both flag forms, missing/empty values, exact RPC payload, attach/error behavior | `src/app/cli.test.ts`, `src/app/commands/start.test.ts` | `bun test src/app/cli.test.ts src/app/commands/start.test.ts` |
| Web API contract | unit/MSW integration | Optional field serialized exactly and omission unchanged | `web/src/lib/api/client.test.ts` | From `web/`: `bunx vitest run src/lib/api/client.test.ts --coverage.enabled=false` |
| Web component/form | component + MSW integration | Listed selector states/order/reset, manual entry, exact POST payload, retained values/error/no navigation | `web/src/features/start-run/*.test.tsx` | From `web/`: `bunx vitest run src/features/start-run/StartRunForm.test.tsx src/features/start-run/StartStepField.test.tsx --coverage.enabled=false` |
| Documentation | none | Build gate only; examples match implemented syntax and API | `README.md` | Build gate |

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --------- | -------------- | --------------- | -------- |
| Bun unit/route | Yes | Injected fakes and per-test temp directories | `run-manager.test.ts`, `start-run.test.ts` |
| Vitest component/MSW | Yes | Per-test QueryClient, reset Zustand state, centralized MSW reset | `StartRunForm.test.tsx`, `web/test/setup.ts` |
| Full integration | No | Daemon/socket/process lifecycle uses shared OS resources | `src/infra/daemon/__tests__/integration/harness.ts` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Focused server or web unit task | Task-specific command from the matrix |
| Full | Adapter/surface completion | `bun test && bun run --cwd web test` |
| Build | Phase/final completion | `bun run typecheck && bun run build && bun run --cwd web typecheck && bun run --cwd web build && bun test && bun run --cwd web test` |

Baseline before implementation: root suite passed on 2026-07-01 with one pre-existing skipped multi-attach test; web suite is measured separately by its task/full gates.

---

## Execution Plan

### Phase 1: Start Contract and Execution (Sequential)

```text
T1 ──→ T2 ──→ T3
```

### Phase 2: User Surfaces (Order-Free Where Marked)

```text
T2 ──→ T4 [P]
T3 ──→ T5 [P]
          T6 [P]
T5 + T6 ──→ T7
```

### Phase 3: Documentation and Final Gate

```text
T4 + T7 ──→ T8
```

---

## Task Breakdown

### T1: Enforce Entry-Step Execution Policy

**What**: Resolve and validate the requested entry step in `RunManager`, then launch the existing runner at it.
**Where**: `src/infra/daemon/run-manager.ts`, `src/infra/daemon/run-manager.test.ts`
**Depends on**: None
**Reuses**: `Workflow.hasStep`, `Workflow.firstStepId`, `Runner.run`
**Requirements**: SFS-01, SFS-02, SFS-03, SFS-04
**Tools**: local filesystem; `tlc-spec-driven`, `no-workarounds`

**Done when**:

- [ ] A valid requested ID is the first current/visited/banner step and predecessors are absent.
- [ ] Omission and explicitly selecting the configured first step retain existing behavior.
- [ ] Initial prompt reaches the selected entry as `user-request`.
- [ ] Missing IDs throw `WorkflowConfigError` before registry/persistence/worktree mutation.
- [ ] Focused gate passes with no deleted/skipped tests.

**Tests**: unit + integration
**Gate**: Quick — `bun test src/infra/daemon/run-manager.test.ts`
**Commit**: `feat(runner): support validated entry steps`

### T2: Propagate Entry Step Through Daemon RPC

**What**: Extend `run.start` RPC typing and handler forwarding with optional `startStepId`.
**Where**: `src/infra/daemon/protocol.ts`, `src/infra/daemon/handlers/run-start.ts`, `src/infra/daemon/handlers/handlers.test.ts`
**Depends on**: T1
**Reuses**: Existing `WorkflowConfigError` to `WORKFLOW_INVALID` mapping
**Requirements**: SFS-01, SFS-04, SFS-10, SFS-13
**Tools**: local filesystem; `tlc-spec-driven`, `no-workarounds`

**Done when**:

- [ ] Exact provided value and omission are both asserted at the manager call.
- [ ] Workflow-invalid mapping is unchanged.
- [ ] Focused gate passes with no deleted/skipped tests.

**Tests**: unit
**Gate**: Quick — `bun test src/infra/daemon/handlers/handlers.test.ts`
**Commit**: `feat(rpc): accept workflow entry step`

### T3: Propagate Entry Step Through HTTP

**What**: Extend the start request schema and route forwarding with optional non-empty `startStepId`.
**Where**: `src/app/api/schema.ts`, `src/app/api/routes/start-run.ts`, `src/app/api/routes/start-run.test.ts`, `src/app/api/schema.test.ts`
**Depends on**: T2
**Reuses**: Existing OpenAPI route and `mapError`
**Requirements**: SFS-01, SFS-04, SFS-06, SFS-09
**Tools**: local filesystem; `tlc-spec-driven`, `no-workarounds`

**Done when**:

- [ ] Exact field forwarding and omitted compatibility are asserted.
- [ ] Empty/non-string fields return HTTP 400 before manager invocation.
- [ ] Manager `WorkflowConfigError` returns 400 `WORKFLOW_INVALID` with the requested ID message.
- [ ] Focused gate passes with no deleted/skipped tests.

**Tests**: route integration
**Gate**: Quick — `bun test src/app/api/routes/start-run.test.ts src/app/api/schema.test.ts`
**Commit**: `feat(api): accept workflow entry step`

### T4: Add Terminal/TUI Start Flag [P]

**What**: Parse `--step`/`--step=`, document it in usage, and forward it through the start RPC payload without changing attach behavior.
**Where**: `src/app/cli.ts`, `src/app/cli.test.ts`, `src/app/commands/start.ts`, `src/app/commands/start.test.ts`
**Depends on**: T2
**Reuses**: `--branch` parser and conditional payload pattern
**Requirements**: SFS-10, SFS-11, SFS-12, SFS-13
**Tools**: local filesystem; `tlc-spec-driven`, `no-workarounds`

**Done when**:

- [ ] Both valid flag forms yield exact `startStepId` payload values.
- [ ] Missing/empty values fail before connecting and usage names the flag.
- [ ] Interactive attach, detach, non-TTY, and mapped error behavior remain exact.
- [ ] Focused gate passes with no deleted/skipped tests.

**Tests**: unit
**Gate**: Quick — `bun test src/app/cli.test.ts src/app/commands/start.test.ts`
**Commit**: `feat(cli): start workflows from a selected step`

### T5: Extend the Web Start Contract [P]

**What**: Add optional `startStepId` to the web request type and assert exact client serialization.
**Where**: `web/src/lib/api/types.ts`, `web/src/lib/api/client.test.ts`
**Depends on**: T3
**Reuses**: Existing `startRun` request serializer
**Requirements**: SFS-06, SFS-08
**Tools**: local filesystem; `tlc-spec-driven`, `react`

**Done when**:

- [ ] Provided step is serialized exactly and omission remains byte-shape compatible.
- [ ] Focused web gate passes with no deleted/skipped tests.

**Tests**: unit/MSW integration
**Gate**: Quick — from `web/`, `bunx vitest run src/lib/api/client.test.ts --coverage.enabled=false`
**Commit**: `feat(web-api): send workflow entry step`

### T6: Create the Web Start-Step Field [P]

**What**: Add a focused accessible component that renders ordered catalog steps or manual ID input and safely validates unknown workflow data.
**Where**: `web/src/features/start-run/StartStepField.tsx`, `web/src/features/start-run/StartStepField.test.tsx`
**Depends on**: None
**Reuses**: Shadcn `Select`/`Input`/`Label`, Zod boundary validation
**Requirements**: SFS-05, SFS-08; workflow-detail loading/error edge case
**Tools**: Context7 findings; `tlc-spec-driven`, `react`, `shadcn`, `tanstack-query-best-practices`, `no-workarounds`

**Done when**:

- [ ] Listed workflow steps appear in source order after `Default (first step)`.
- [ ] Loading, query error, and malformed-document states are explicit and non-crashing.
- [ ] Manual mode renders an exact-ID input.
- [ ] Radix keyboard/accessibility behavior and design tokens are preserved.
- [ ] Focused web gate passes with no deleted/skipped tests.

**Tests**: component
**Gate**: Quick — from `web/`, `bunx vitest run src/features/start-run/StartStepField.test.tsx --coverage.enabled=false`
**Commit**: `feat(web): add workflow entry-step field`

### T7: Integrate Entry-Step Selection into Start Form

**What**: Load the selected scoped workflow, reset entry state in user event handlers, include it conditionally in start requests, and preserve it on errors.
**Where**: `web/src/features/start-run/StartRunForm.tsx`, `web/src/features/start-run/StartRunForm.test.tsx`
**Depends on**: T5, T6
**Reuses**: `useWorkflow`, `workflowBareName`, existing mutation/navigation behavior
**Requirements**: SFS-05, SFS-06, SFS-07, SFS-08, SFS-09
**Tools**: Context7 findings; `tlc-spec-driven`, `react`, `shadcn`, `tanstack-query-best-practices`, `no-workarounds`

**Done when**:

- [ ] Catalog selection loads the scoped workflow and submits the selected exact ID.
- [ ] Changing workflow or switching to manual path resets stale entry state.
- [ ] Manual path submits trimmed exact ID and blank input omits it.
- [ ] Server rejection retains workflow/step values and prevents navigation.
- [ ] Focused gate passes with no deleted/skipped tests.

**Tests**: component + MSW integration
**Gate**: Full — from `web/`, `bunx vitest run src/features/start-run/StartRunForm.test.tsx src/features/start-run/StartStepField.test.tsx --coverage.enabled=false`
**Commit**: `feat(web): start workflows from a selected step`

### T8: Document and Run the Final Build Gate

**What**: Document CLI/API examples, update task/spec traceability, and run the complete server/web build and test gate.
**Where**: `README.md`, `.specs/features/start-workflow-from-step/*.md`
**Depends on**: T4, T7
**Reuses**: Existing README CLI/API sections and TLC artifacts
**Requirements**: SFS-01 through SFS-13
**Tools**: local filesystem; `tlc-spec-driven`

**Done when**:

- [ ] README shows `--step` and `startStepId` without changing unrelated documentation.
- [ ] All task and requirement statuses reflect implementation state.
- [ ] Build gate passes with test counts recorded and no new skips.

**Tests**: none — documentation; complete gate verifies implementation
**Gate**: Build — `bun run typecheck && bun run build && bun run --cwd web typecheck && bun run --cwd web build && bun test && bun run --cwd web test`
**Commit**: `docs: document workflow entry steps`

---

## Parallel Execution Map

```text
Phase 1: T1 → T2 → T3
Phase 2: T4 [P], T5 [P], T6 [P]; then T5 + T6 → T7
Phase 3: T4 + T7 → T8
```

`[P]` indicates no mutual implementation dependency and parallel-safe focused tests. Execution remains inline because the plan has three phases.

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1 | One manager policy + co-located tests | ✅ Granular |
| T2 | One RPC contract/adapter + tests | ✅ Granular |
| T3 | One HTTP contract/route + tests | ✅ Granular |
| T4 | One terminal launch surface + tests | ✅ Granular |
| T5 | One web wire contract + tests | ✅ Granular |
| T6 | One UI component + tests | ✅ Granular |
| T7 | One form integration + tests | ✅ Granular |
| T8 | One documentation/traceability closeout | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On | Diagram Shows | Status |
| ---- | ---------- | ------------- | ------ |
| T1 | None | Root | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T2 | T2 → T4 | ✅ Match |
| T5 | T3 | T3 → T5 | ✅ Match |
| T6 | None | Root | ✅ Match |
| T7 | T5, T6 | T5 + T6 → T7 | ✅ Match |
| T8 | T4, T7 | T4 + T7 → T8 | ✅ Match |

## Test Co-location Validation

| Task | Layer | Matrix Requires | Task Says | Status |
| ---- | ----- | --------------- | --------- | ------ |
| T1 | Run orchestration | unit + integration | unit + integration | ✅ |
| T2 | RPC adapter | unit | unit | ✅ |
| T3 | HTTP route | route integration | route integration | ✅ |
| T4 | CLI/TUI adapter | unit | unit | ✅ |
| T5 | Web API | unit/MSW | unit/MSW | ✅ |
| T6 | Web component | component | component | ✅ |
| T7 | Web form | component/MSW | component/MSW | ✅ |
| T8 | Documentation | none | none | ✅ |

## Tool Selection

- Server tasks: local code tools plus `tlc-spec-driven` and `no-workarounds`.
- Web tasks: local code tools plus `react`, `shadcn`, `tanstack-query-best-practices`, `no-workarounds`; Context7 findings apply to conditional queries.
- No sub-agents: three phases execute inline; final verification uses TLC's standalone fresh-eyes fallback because delegation was not requested.
