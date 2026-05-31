# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Establish shared Zod schemas in `src/app/api/schema.ts` and install `hono`, `@hono/zod-openapi`, `zod` as runtime deps. Lock the wire contract with a round-trip conformance test.

## Important Decisions

- `RunEvent.event` is `z.unknown()` per TechSpec — not validated beyond schema structure. The conformance test verifies payload is not transformed.
- `RunDetail` excludes `kickoffPrompts` and `endReason` (explicit TechSpec field list only: id, slug, workflowPath, status, currentStepId, visitedStepIds, startedAt, endedAt, attachedCount).
- Schemas use plain `z.string()` for id/slug (not branded types) — these are public wire shapes.
- `RunStatusSchema` re-declares the status enum in the API layer (does not import domain `RunStatus`) — appropriate since schemas live in `src/app/api/`, not `src/domain/`.
- Conformance test calls `Tui.onEvent()` directly (it's public) without attaching a source — avoids complex fake-source wiring for render comparison.

## Learnings

- `import.meta.url` works in Bun test files for `Bun.file(new URL(...))` fixture loading.
- Bun installed hono@4.12.23, @hono/zod-openapi@1.4.0, zod@4.4.3.
- `@opentui/core/testing` exports `createTestRenderer` with `renderer`, `renderOnce`, `captureCharFrame`.

## Files / Surfaces

- `package.json` — added hono, @hono/zod-openapi, zod runtime deps
- `src/app/api/schema.ts` — new, all schemas + inferred types
- `src/app/api/__fixtures__/events.jsonl` — 9-line fixture covering all RunnerEvent types
- `src/app/api/schema.test.ts` — 43 tests (43 pass), round-trip conformance + all unit tests

## Errors / Corrections

None.

## Ready for Next Run

Task complete. All deliverables implemented and verified:
- `src/app/api/schema.ts` exports all 10 schemas + types
- `package.json` has 3 new runtime deps
- 43 tests pass (0 fail), typecheck clean
- Round-trip conformance test using `createTestRenderer` + `Tui.onEvent` direct call
