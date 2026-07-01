# Step Model Variant Validation

**Date**: 2026-07-01
**Spec**: `.specs/features/step-model-variant/spec.md`
**Implementation diff**: `28c05f3..9dfbf64`
**Verifier**: standalone fresh-eyes fallback (sub-agent delegation was not authorized)

## Task Completion

| Task | Status | Commit |
| --- | --- | --- |
| Domain and ACP session behavior | Done | `6f1e3b8` |
| Workflow editor persistence and field | Done | `9dfbf64` |

## Spec-Anchored Acceptance Criteria

| Requirement | Spec-defined outcome | Evidence | Result |
| --- | --- | --- | --- |
| SMV-01 | A configured value is retained exactly | `src/domain/workflow.test.ts:102` — `expect(workflow.steps[0].variant).toBe("high")` | PASS |
| SMV-02 | Omission preserves the default and makes no config call | `src/domain/workflow.test.ts:110` — `expect(workflow.steps[0].variant).toBeUndefined()`; `src/infra/acp/ide-profiles.test.ts:320` — `expect(calls).toEqual([setSessionMode, unstable_setSessionModel])` | PASS |
| SMV-03 | The advertised thought-level config is set to the exact value after the model | `src/infra/acp/ide-profiles.test.ts:287` — ordered `expect(calls).toEqual([... "unstable_setSessionModel", "setSessionConfigOption:reasoning-effort:high"])` | PASS |
| SMV-04 | Unsupported or rejected variants fail with step and variant context | `src/infra/acp/ide-profiles.test.ts:338` and `:370` — exact `rejects.toThrow(...)` assertions | PASS |
| SMV-05 | The editor reloads and saves the exact value | `web/src/features/workflows/WorkflowDraftSchema.test.ts:279` and `:338`; `web/src/features/workflows/WorkflowEditor.test.tsx:366` — exact `high` assertions | PASS |
| SMV-06 | A blank editor value is omitted from the saved step | `web/src/features/workflows/WorkflowDraftSchema.test.ts:345` — `expect(steps[0]).not.toHaveProperty('variant')` | PASS |

**Status**: 6/6 acceptance criteria match their spec-defined outcomes.

## Edge Cases

- Invalid whitespace-only configured value: `src/domain/workflow.test.ts:287` asserts a variant-named load error.
- Missing advertised option and agent rejection are both covered by SMV-04.

## Discrimination Sensor

Mutations ran in detached worktree `/tmp/workflow-runner-variant-verify`; the worktree was removed afterward and the real implementation was never modified.

| Mutation | Location | Behavior fault | Result |
| --- | --- | --- | --- |
| 1 | `src/infra/acp/ide-profiles.ts:68` | Inverted the optional-variant guard, disabling configured variants and attempting undefined variants | KILLED — profile suite exited 1 with 28 failures |
| 2 | `web/src/features/workflows/WorkflowDraftSchema.ts:139` | Reversed payload inclusion, dropping configured variants and emitting blank variants | KILLED — targeted web suite exited 1 with 3 failures |

**Sensor result**: 2/2 mutations killed — PASS.

## Gate Check

- Backend tests: `bun test` — 1,269 passed, 1 pre-existing skip, 0 failed.
- Backend typecheck/build: `bun run typecheck && bun run build` — exit 0.
- Web tests: `bun run test -- --reporter=dot` — exit 0; coverage 94.45% statements, 87.19% branches, 96.28% functions, 95.68% lines.
- Web typecheck/build: `bun run typecheck && bun run build` — exit 0.
- Relevant targeted baseline: 132 tests before; 152 after; delta +20.
- Full post-change total: 1,750 passing tests; 1 pre-existing skipped backend integration test.

## Code Quality

| Check | Result |
| --- | --- |
| Minimum implementation; no fixed provider enum | PASS |
| Surgical changes limited to workflow, ACP profile, and editor paths | PASS |
| Existing workflows remain valid when `variant` is absent | PASS |
| Tests map directly to all acceptance criteria and listed failures | PASS |
| No shallow assertions or unclaimed feature tests | PASS |
| Project guidance followed | PASS — `CLAUDE.md` |

Known non-blocking pre-existing warnings: jsdom `scrollTo` notices, MSW unhandled-request notices, and Vite's large-chunk warning.

## Summary

**Overall**: PASS — ready.
