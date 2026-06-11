# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Web-facing half of worktree isolation: optional branch input on the start form (sends `branch` only when non-empty), and worktree path/branch shown on run detail for isolated runs. Mirrors CLI flag (task_06). Depends on task_05 HTTP surface.

## Important Decisions

- RunView reads the run snapshot over the WebSocket (`useAttach` → snapshot frame), NOT the HTTP `GET /runs/:id`. So worktree/branch must arrive on the WS snapshot frame + the zod `RunDetailSchema` in `web/src/lib/api/client.ts` (z.object strips unknown keys, so the fields must be declared there or they vanish before reaching the reducer).
- Isolation start errors (`NOT_A_GIT_REPO`/`WORKTREE_CONFLICT`) need no special-casing in the form: the server returns 400 with `code`+`message`, `ApiError` carries the message, and the existing `submit-error` paragraph renders `mutation.error.message`. Just covered by a test.
- Branch sent via conditional spread `...(branch ? { branch } : {})` so empty input ⇒ unchanged non-isolated payload `{ workflowPath, cwd }`.

## Learnings

- `bun test` MUST be run from the project root; running it inside `web/` makes bun's native runner execute the vitest/jsdom web tests directly → hundreds of spurious failures. Web tests run via `bun run test` (vitest) from `web/`; server tests via `bun test` from root.
- Web run-detail data path: WS attach snapshot → `attach-client` (`AttachFrameSchema`) → `reducer` → `vm.snapshot` (`RunDetail`). The HTTP `GET /runs/:id` is NOT used by RunView.
- Cross-feature integration test pattern: route `/runs/$runId` to the real `RunView`, stub `WebSocket` with a fake recording instances, submit the start form, then `ws.receive({type:'snapshot', ...})` and assert. Needs `scrollIntoView` stub (Transcript) — jsdom lacks it.

## Files / Surfaces

- `web/src/lib/api/types.ts` — `StartRunRequest.branch?`, `RunSummary`/`RunDetail` `worktreePath?`+`branch?`.
- `web/src/lib/api/client.ts` — zod `RunDetailSchema` gains `worktreePath`/`branch` optional.
- `web/src/features/start-run/StartRunForm.tsx` — branch Input + payload.
- `web/src/features/run-view/RunView.tsx` — isolation display from `vm.snapshot`.
- `src/app/api/routes/ws-attach.ts` (SERVER) — snapshot frame must also emit `worktreePath`/`branch`.

## Errors / Corrections

- task_05 GAP: `src/app/api/routes/ws-attach.ts` snapshot frame omits `worktreePath`/`branch` (only `routes/run-detail.ts` HTTP path got them). Fixed here because the web run-detail view consumes the WS snapshot, not the HTTP endpoint. Minimal one-line additions, matching the existing `cwd` field.

## Ready for Next Run

task_07 COMPLETE. Web isolation surfaces shipped + tested (web 453 pass, root 1112 pass, both typechecks clean). All 8 worktree-run tasks now done. Server gap fixed: `ws-attach.ts` snapshot frame now emits `worktreePath`/`branch` (task_05 had only covered the HTTP `GET /runs/:id` route). No commit created (auto-commit disabled) — diff left for manual review.
