# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add required `ide` validation to `validateStep` in `src/domain/workflow.ts`: reject missing or empty/whitespace `ide` with `WorkflowConfigError("Step '<id>': missing or empty 'ide'")`. Remove the `""` default fallback.

## Important Decisions

- Guard placed after `model` check, before `mode` check — mirrors agent/model pattern.
- TypeScript control-flow narrowing means `ide: s.ide` is typed as `string` after the guard, no cast needed.

## Learnings

- All existing test fixtures (runner.test.ts, run-manager.test.ts, agent-session.test.ts, mcp-server.test.ts, etc.) already had `ide` set — no fixture updates required.
- New valid-config tests must use steps without inter-step edges (e.g., `steps[1]` or `steps[2]`) to avoid dangling-edge errors when reducing to a single-step config.
- `ide: ""` tests in agent-session.test.ts use `factory.create()` directly (not through `Workflow.fromJson`), so they remain valid; the factory still throws `UnknownIdeError` for empty string.

## Files / Surfaces

- `src/domain/workflow.ts` — added `ide` guard at line ~152; changed return `ide: s.ide`.
- `src/domain/workflow.test.ts` — 6 new tests added (3 rejection, 2 valid-acceptance, 1 integration).

## Errors / Corrections

- Initial valid-config tests used `steps[0]` which has edges to step-2/step-3; failed with dangling-edge error. Fixed by using `steps[1]` (no edges) as the base for single-step configs.

## Ready for Next Run

Task complete. 796 tests pass, typecheck clean. No fixture changes needed — all pre-existing fixtures already had `ide`.
