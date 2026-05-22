# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

Tasks 01 and 02 are complete. `src/workflow.ts` (types + loader) and `src/workflow.test.ts` are created.

## Shared Decisions

- **bun-types** must be installed as a devDependency for `bun:test` imports to pass `tsc --noEmit`. It was added in task 02 and is now in `package.json` + `tsconfig.json`. Future tasks writing test files should import from `bun:test` without additional setup.
- **Two-pass edge validation** in `loadWorkflow` allows forward references (step-1 can reference step-3 before step-3 is validated). This pattern should be reused if any future validation needs the full id set.
- **Top-level Workflow fields** (`id`, `name`, `description`, `version`) are passed through with empty-string fallbacks; only `steps` is validated for presence/non-emptiness.

## Shared Learnings

- `bun-types` is NOT auto-installed by Bun — it requires explicit `bun add -d bun-types`.
- TypeScript strict mode + `bun-types`: `toBe()` overloads on union literal types require the argument to match the same union, not just `string`. Always type inline fixtures with precise literal unions when asserting against typed return values.

## Open Risks

- `unstable_setSessionModel` (task 04/05) is an unstable ACP method — isolate in a single function so failures are contained to a step failure.

## Handoffs

- task_03 (mcp.ts): imports `Step`, `Edge` from `./workflow.js`; also needs `StepOutcome` type (declare in `runner.ts` or `mcp.ts`, task 03 owns it per TechSpec).
- task_04 (runner.ts): imports `Workflow`, `Step`, `loadWorkflow` from `./workflow.js`.
