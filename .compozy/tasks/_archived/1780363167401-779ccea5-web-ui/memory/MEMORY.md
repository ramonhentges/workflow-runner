# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- task_01 complete: Bun workspaces + Turborepo wired. `web/` is a placeholder workspace; full scaffold is task_04.
- task_02 complete: env-gated CORS + WS Origin allowlist in daemon API. `WORKFLOW_RUNNER_UI_ORIGIN` gates behavior; unset = no change to security posture.

## Shared Decisions

- Root `package.json` stays at repo root as both the runner package and the workspace root (`"workspaces": ["web"]`). Runner scripts are unchanged; turbo-delegating scripts added as `turbo:*` variants.
- `//#task` notation in `turbo.json` includes the root runner in the turbo pipeline. All four tasks (build/dev/typecheck/test) have both workspace and `//#` root variants.
- `web/package.json` name is `@workflow-runner/web`. Placeholder echo scripts for all tasks; replaced in task_04.

## Shared Learnings

- WS testing in Vitest/jsdom: use `vi.stubGlobal('WebSocket', FakeWebSocket)` + `vi.unstubAllGlobals()` in beforeEach/afterEach. FakeWebSocket must implement `addEventListener`, `send`, `close`, and `readyState`. The `receive(data)` helper emits a message event with `{ data: JSON.stringify(data) }`.
- Zod v4 `z.unknown()` for `RunEvent.event` means the inferred type doesn't match `RunnerEvent`. Use `as unknown as AttachFrame` for the cast in the socket wrapper; validate with `RunnerEventSchema.safeParse()` in the reducer.

- Turbo v2.9.16 (installed) requires `"packageManager": "bun@1.3.14"` in root `package.json` to resolve Bun workspaces. Without it turbo exits with "Could not resolve workspaces."
- `//#task` in `turbo.json` runs the root's script directly — avoids recursion as long as the root's own scripts do not themselves call `turbo run`.
- Hono CORS middleware must wrap `c.res = new Response(c.res.body, c.res)` before mutating headers post-`next()` to avoid frozen-headers. Pattern used in `corsMiddleware` in `security.ts`.
- `isOriginAllowed` reads `WORKFLOW_RUNNER_UI_ORIGIN` internally; no call-site changes needed (ws-attach.ts unchanged).
- Bun workspace root: `bun test` sweeps ALL packages including `web/` even with `bunfig.toml root = "./src"`. Always use `bun run test` (vitest) for web tests, never `bun test`.
- Tailwind v4 uses `@tailwindcss/vite` plugin (no postcss/tailwind.config.ts). CSS uses `@import "tailwindcss"` + `@theme inline` + `@custom-variant dark`.
- Vitest 4 + @testing-library/jest-dom: needs `globals: true` in vitest config + `"types": ["vitest/globals"]` in tsconfig so jest-dom can call `expect.extend`.
- `vite-env.d.ts` with `/// <reference types="vite/client" />` is required to type `import.meta.env` and allow CSS side-effect imports in TS 6.
- HTTP client functions must call `getApiBaseUrl()` at request time (not module-level), so tests can override `import.meta.env.VITE_API_BASE_URL` before calling.
- `GET /runs` returns `{ runs: RunSummary[] }` (wrapped envelope), not a bare array — client must extract `.runs`.
- Each web workspace package must declare its own `zod` dependency in `web/package.json` even though root workspace also has it.

## Open Risks

(task_04 resolved: `web/` skeleton complete, all scripts functional)

## Shared Learnings (continued)

- Zustand v5 `persist` stores `{ state: { ...dataFields }, version: 0 }` in localStorage; functions are excluded by JSON.stringify automatically.
- Zustand v5 in tests: use `setState({ cwds: [], activeCwdId: null })` (no replace flag) to reset only data fields while preserving action functions. Using `true` (replace) wipes the functions.
- Zustand persist rehydration test pattern: `setState(empty)` → `localStorage.setItem(testData)` → `await (store as any).persist.rehydrate()`. The setState() fires the persist subscriber synchronously, so localStorage.setItem() must come AFTER setState() to override it.
- No `@radix-ui/*` packages installed in web/. shadcn-style components (Button, Input, Label) were created manually in `web/src/components/ui/` using `cn()` + Tailwind only. Do not assume Radix is available for tasks 08–11.
- CwdSwitcher list item design: put the cwd label-only as the switch button text, path as a sibling `<span>`. This lets RTL `getByRole('button', { name: 'label' })` find it without path text noise. Remove button uses `aria-label="Remove {label}"`.

## Handoffs

- task_11 complete: AppShell + full route tree done. `web/src/app/AppShell.tsx` (sidebar nav + CwdSwitcher), `web/src/router.tsx` (rootRoute=AppShell, notFoundComponent on rootRoute, /=RunsTable, /start=StartRunForm, /runs/$runId=RunPage→RunView). 180 tests pass, 98.92% coverage. All features wired end-to-end. Socket teardown on route leave is handled by existing useAttach useEffect cleanup — no extra code needed.

---

- task_04 complete: `web/` SPA scaffold done. Vite 8/React 19/TS 6/Tailwind v4/TanStack Router v1/Query v5/Vitest 4/MSW 2. All tests pass (100% coverage). Tasks 05–11 can proceed.
- task_03 complete: `GET /workflows?cwd=` endpoint implemented. `WorkflowsQuerySchema` + `WorkflowListSchema` in `schema.ts`. Route at `routes/workflows.ts`, registered in `app.ts`. 14 tests, all passing.
- Web tasks (05+): set `WORKFLOW_RUNNER_UI_ORIGIN=http://localhost:<vite-port>` when running the daemon for manual testing.
- task_09 (Start-run flow) can now proceed — its dependency on task_03 is satisfied.
- task_05 complete: `web/src/lib/api/types.ts` + `client.ts` done. 40 tests pass, 100% stmts/funcs/lines, 95.45% branches. Zod schemas exported for task_06 WS client.
- task_06 complete: `web/src/lib/ws/` done. reducer.ts + attach-client.ts + use-attach.ts. 78 tests pass, 98.48% stmts coverage. `useAttach` returns `{ vm: RunViewModel, sendInput }`. `RunViewModel` has `closed: boolean` (not in TechSpec but required). `TranscriptItem` has supplemental `streamKind?` for coalescing.
- task_07 complete: `web/src/stores/cwd-store.ts` + `web/src/features/cwd/CwdSwitcher.tsx` done. 26 new tests (17 unit + 9 RTL), 101 total pass. shadcn Button/Input/Label created in `web/src/components/ui/`. `useCwdStore` is the single source for active cwd in tasks 08–09. Import: `@/stores/cwd-store`. task_08 and task_11 can now proceed.
- task_08 complete: `web/src/features/dashboard/useRuns.ts` + `RunsTable.tsx` done. 116 tests pass (15 new), 98.54% coverage. `router.tsx` gained `/runs/$runId` placeholder so `Link` is type-safe; task_11 replaces the placeholder component. TanStack Query `defaultOptions.refetchInterval` does NOT override per-query `refetchInterval` in v5 — background refetch in tests is harmless (tests finish before the 2s interval fires).
- task_09 complete: `web/src/features/start-run/useWorkflows.ts` + `StartRunForm.tsx` done. 131 tests pass (15 new), 98.75% coverage. Native `<select>` used for picker (no Radix). `/start` route NOT added to router (task_11 handles routing). `useNavigate` requires router context even in "unit" form tests — use test router helper. `findByLabelText('Workflow')` (exact) waits for select to appear after workflows load; regex `/workflow/i` is ambiguous (also matches "Workflow path" label on input).
- task_10 complete: `web/src/features/run-view/` done (RunView + Transcript + StepProgress + InputBox + RunControls). 169 tests pass (38 new), 98.54% coverage. `RunView` receives `runId` prop — task_11 passes it from router params. `window.HTMLElement.prototype.scrollIntoView = vi.fn()` needed in `beforeAll` for RTL tests (jsdom does not implement it). RunView integration tests: wrap in `QueryClientProvider` + `vi.stubGlobal('WebSocket', FakeWebSocket)`. Summary panel conditioned on `isTerminal && summary !== null`.
