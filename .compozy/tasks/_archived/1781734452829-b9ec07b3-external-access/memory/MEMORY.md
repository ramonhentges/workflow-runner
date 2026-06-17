# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

Task 01 (bindHost + resolveBindHost) complete. Task 02 (wire `--host` flag through CLI) complete. Task 03 (Update `Bun.serve()` and replace loopback assertion) complete. Task 04 (Parameterize security middleware with `bindHost`) complete.

## Shared Decisions

- Env var name is `WORKFLOW_RUNNER_HOST` (not `WORKFLOW_RUNNER_BIND_HOST` from PRD/ADR). TechSpec establishes the `--flag` → `WORKFLOW_RUNNER_FLAG` naming pattern matching `--api-port` → `WORKFLOW_RUNNER_API_PORT`.
- `resolveBindHost()` follows the exact pattern of `resolveApiPort()` — explicit opt > env > default.

## Shared Learnings

## Open Risks

## Shared Learnings

- TypeScript narrows `process.env` property accesses after `delete` — use `readEnv(key)` helper to prevent typecheck failures with `expect().toBe()`.

## Handoffs
