# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement typed HTTP client + wire types in `web/src/lib/api/`. Task complete.

## Important Decisions

- `listRuns()` extracts `data.runs` from the `{ runs: RunSummary[] }` response envelope (daemon returns wrapped array, not bare array).
- `apiFetch` calls `getApiBaseUrl()` at call time (not module-level constant) so tests can override `import.meta.env.VITE_API_BASE_URL` before calling an endpoint.
- `all` param for `listRuns` is sent as string `"true"` only when truthy (omitted otherwise) to match daemon's `all === "true"` check.
- Zod validators (`AttachFrameSchema`, `RunnerEventSchema`, `RunEventSchema`, `RunStatusSchema`) exported from `client.ts` for reuse by task_06 WS client.

## Learnings

- `bun run test` (vitest) must be used for web tests; `bun test` at root picks up web files without MSW and fails fetch-based tests.
- `stopRun` returns `{ finalStatus: string }`, `retryStep` returns `{ resumedStepId: string }` — these shapes come from the daemon routes, not schema.ts.
- `zod` must be declared in `web/package.json` even though it's a root workspace dep; added as `"^4.4.3"`.

## Files / Surfaces

- `web/package.json` — added `"zod": "^4.4.3"` to dependencies
- `web/src/lib/api/types.ts` — new: all wire types
- `web/src/lib/api/client.ts` — new: apiFetch helper, 7 endpoint functions, ApiError, 4 zod schemas
- `web/src/lib/api/client.test.ts` — new: 40 tests (26 zod/unit + 14 MSW integration), 100%/95.45% coverage

## Errors / Corrections

None.

## Ready for Next Run

- task_06 (WS client): import `AttachFrameSchema`, `RunnerEventSchema`, `RunEventSchema`, `RunStatusSchema` from `@/lib/api/client`.
- task_06 (WS client): import wire types (`RunDetail`, `RunStatus`, `AttachFrame`, `RunEvent`) from `@/lib/api/types`.
