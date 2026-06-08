# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- Task 01 done: status tokens + `StatusBadge` shipped and verified.
- Task 02 done: `AppShell` migrated to shadcn `sidebar-07` (inset, `collapsible="icon"`); sidebar + peers (sheet/tooltip/separator/skeleton) + `use-mobile` hook added.
- Task 03 done: `RunsTable` migrated to shadcn `Table` (icon-first GH-Actions rows: status → workflow → current step → started → duration); `table` primitive added; `statusClass()` removed; in-view `formatDuration`.
- Task 04 done: `StatusSummaryCards` (5 cards, counts from `useRuns`, Failed emphasized) rendered inside `RunsTable`; `?status=` URL filter via `indexRoute` `validateSearch`.
- Task 06 done: `WorkflowEditor`/`StepFields`/`EdgesField` re-skinned to shadcn; step `ide`/`mode` moved to `Controller`+`Select` (ADR-005), custom-IDE round-trip preserved. EdgesField `next_step` left as native `<select>` (re-skinned only — out of ADR-005 scope). `AgentModelPicker` already shadcn, unchanged.
- Task 07 done: `WorkflowList` re-skinned to shadcn `Table` wrapped in `Card`; no new primitives needed (table/card/button already present). Inline two-step delete-confirm (Delete→Confirm/Cancel buttons in-row) KEPT, NOT migrated to AlertDialog — a Radix portal AlertDialog renders outside the row and breaks `within(row).getByRole(...,{name:'Confirm'})`; the "preserve delete-confirm behavior + every prior selector resolves" requirement beats the conditional Dialog/Alert mention. Added the missing list error-state test. Tasks 05, 08–10 pending.
- Task 09 done: hand-rolled `ThemeProvider`+`useTheme` (`web/src/components/theme-provider.tsx`, `'system'|'light'|'dark'`, `.dark` on `documentElement`, `localStorage('theme')`, system-change listener, matchMedia-guarded) + `ModeToggle` (`mode-toggle.tsx`, shadcn `dropdown-menu`) in shell header `header-actions` slot. `main.tsx` order: `ThemeProvider > QueryClientProvider > RouterProvider`. No new runtime dep. Tasks 05 already done (master file); only Task 10 pending.
- Task 08 done: run-view feature (`RunView`/`RunControls`/`Transcript`/`InputBox`/`StepProgress`) re-skinned to shadcn. Banners→`Alert`, summary→`Card`, step pills→`Badge`, `StatusBadge` added to `RunControls` toolbar. `useAttach`/reducer/protocol untouched. Added `alert` primitive. Tasks 05, 09, 10 pending.
- Task 10 done: skeletons + action-oriented empty states. Implementation was already present in the working tree on entry (`RunsTable` `loading-state` skeleton rows `run-row-skeleton` + `no-runs-state` action `start-run-action`→/start; `StatusSummaryCards` `StatusCardsSkeleton` testid `status-cards-skeleton`; `WorkflowList` `workflows-loading`/`workflow-row-skeleton` + `no-workflows-state` action `create-first-workflow-action`→/workflows/new). `skeleton` primitive already present (task_02 sidebar peer). The only gap was test coverage in `WorkflowList.test.tsx` — added loading-skeleton, skeleton→loaded transition, and empty-state-action (link + navigation) tests. No implementation file touched; data-fetching unchanged. Final gate: 25 files / 369 tests pass, coverage 94.68%/85.03%. **All 10 web-improvement tasks now complete.**

## Shared Decisions

- `StatusBadge` (`web/src/components/status-badge.tsx`) is the single source of run-status presentation. Consume it everywhere; do not reintroduce ad-hoc status color logic. API: `status`, `showLabel` (default true; `false` = icon-only for dense cells), `className`. Renders a `Badge` with `data-status={status}` for selector targeting.
- Status color utilities: `text-status-{running|completed|failed|crashed|aborted}` and `bg-status-…/10`, backed by `--status-*` (`:root`/`.dark`) wired through `@theme inline` as `--color-status-*` in `web/src/index.css`.
- Add shadcn primitives only when a task actually consumes them (see coverage learning). Task 01 kept only `badge` + `card`; `table` deferred to the tasks that use them (`skeleton` arrived as a sidebar peer in Task 02).
- Coverage now EXCLUDES `src/components/ui/**` + `src/hooks/use-mobile.ts` (`web/vite.config.ts`). Rationale: large generated Radix wrappers (sidebar.tsx is 726 lines) can't hit 80% branch coverage without testing the primitive internals (an anti-pattern). Net effect: the "only add what's imported/tested" rule now applies to OUR components (e.g. `status-badge.tsx`), not to generated `ui/` primitives — future tasks (select/dialog/dropdown/alert) can add primitives via CLI without fighting coverage.
- `AppShell` now consumes `useTheme` (renders `ModeToggle`). Any test that mounts the shell via `RouterProvider` MUST wrap in `<ThemeProvider>` or `useTheme` throws. Already done for `App.test.tsx`, `routing.test.tsx`, `AppShell.test.tsx` — mirror this in any new shell-mounting test.
- Shared jsdom shims live in `web/test/setup.ts`: `matchMedia` (default `matches:false`) and a no-op `ResizeObserver`. Radix components need them (sidebar tooltips require ResizeObserver; `useIsMobile` requires matchMedia). The ADR-005 Select tasks must ADD pointer shims here (`hasPointerCapture`, `scrollIntoView`) — extend, don't duplicate.
- Sidebar CSS tokens were rewritten from the CLI's `hsl(...)` output to oklch zinc values in `index.css` to keep ONE color system. When a future primitive's CLI run adds `hsl` tokens, convert them to oklch to match.
- `RUN_STATUSES` (const, display order) + `parseStatus()` live in `web/src/lib/api/types.ts`; `RunStatus` is derived from the const (single source). Reuse these for any status-driven UI/param parsing — do NOT re-hardcode the five-status list. (Note: `lib/api/client.ts` still has a separate `RunStatusSchema = z.enum([...])` not yet unified.)
- Dashboard status filter is a typed URL param: `indexRoute.validateSearch` returns `{ status?: RunStatus }` (unknown→undefined). Components read it with `useSearch({ strict: false })` + `parseStatus` so they stay usable in standalone test routers. `navigate({ to: '/', search: { status } })`; re-clicking the active card passes `undefined` to clear (ADR-003).
- Clickable shadcn `Card`: it's a plain div (no `asChild`) — wrap with `<Card className="p-0">` + inner `<button>` that carries testid/aria-pressed/onClick (the whole card is one accessible control).
- Radix `Select` + RHF: wrap in `Controller` (`value`/`onValueChange`), keep the field `id`+`data-testid` on `SelectTrigger`. In tests, drive it like StartRunForm: click the trigger (`getByTestId`), then `getByRole('option', { name })`; assert the bound value via trigger `toHaveTextContent` (NOT `.value`). ADR-005 scope is exactly three selects: start-run picker + step `ide`/`mode`. The edge `next_step` select is NOT in scope — it stays native (re-skinned only); its tests still use `selectOptions`/`.options`.

## Shared Learnings

- shadcn CLI works in this env: `bunx shadcn@latest add <comp>` (run from `web/`). It installs the unified `radix-ui` package — generated primitives import e.g. `Slot` from `"radix-ui"`, not `@radix-ui/react-slot`.
- CLI prompts per-file to overwrite EXISTING files (e.g. our hand-authored `button.tsx`/`input.tsx`) and hangs with no TTY (`--yes` only answers the dep-install prompt, not overwrites). Run `yes N | bunx shadcn@latest add <comp>` to keep existing files while creating new ones.
- Vitest coverage `include: src/**/*.{ts,tsx}` with global 80% thresholds counts EVERY src file, so unused generated files lower coverage and can fail the suite. Only add primitives that are imported/tested.
- lucide-react renders `<svg class="lucide lucide-<kebab-name>">`; query icons in tests by `.lucide-<kebab-name>`.
- shadcn `table` primitive is plain HTML (no Radix), so it needs NO jsdom shims. Badge renders `data-slot="badge"`; assert an icon-only `StatusBadge` via `[data-slot="badge"][data-status="..."]` or `getByLabelText('<Capitalized label>')` (and `queryByText('<lowercase status>')` being absent proves it's a badge, not a raw status span).
- shadcn `alert` primitive (`components/ui/alert.tsx`, plain HTML, no shims) HARDCODES `role="alert"` on the root but spreads `{...props}` AFTER it — so a `role="status"` (or any) override works by just passing the prop. Root carries `data-slot="alert"`; keep feature testids on the `<Alert>` element. Used for run-view socket banners (Task 08).
- web/ runs on node_modules at the repo root (workspace); web test gate is `bun run test` (= `vitest run --coverage`) from `web/`, plus `bun run typecheck`.
- `vitest` (esbuild) does NOT type-check — a green `bun run test` can sit on top of a red `bun run typecheck`. Always run BOTH gates; don't infer typecheck health from a passing test run. (Hit in task_07: a task_06 `tsc` error in `WorkflowEditor.test.tsx` was invisible to the test run.)
- TS gotcha for MSW-handler captures: `let x: T | null = null` assigned ONLY inside a request-handler closure narrows back to `null` at later assertions (CFA can't see the closure write), breaking `x as T`. Use `let x: unknown = null` and cast at the assertion site (the working idiom already in `WorkflowEditor.test.tsx`).

## Open Risks

- The suite (now 22-file, 323-test) is the per-PR regression gate; every migration must carry `data-testid`s/roles forward and land green (ADR-001).
- Coverage-vs-generated-primitives risk is RESOLVED via the `ui/**` coverage exclude (see Shared Decisions); the gate now measures app code only.

## Handoffs

- Task 10 (skeletons/empty states): `RunsTable` empty/loading states are `no-cwd-state` / `no-runs-state` / `loading-state` / `error-state` / `no-filtered-runs-state` (runs exist but the `?status=` filter matches none) — extend these, don't replace.
