# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Scaffold `web/` into a runnable React SPA with Vite/React/TS/TanStack Router/TanStack Query/Tailwind v4/shadcn/Vitest+RTL+MSW. STATUS: COMPLETE.

## Important Decisions

- Used Tailwind v4 (`@tailwindcss/vite` Vite plugin, `@import "tailwindcss"` in CSS). No `tailwind.config.ts` required.
- `globals: true` in Vitest config required so `@testing-library/jest-dom` can call `expect.extend`. Added `"types": ["vitest/globals"]` in tsconfig.json.
- `config.ts` exports `getApiBaseUrl()` function (reads `import.meta.env` at call time) + `API_BASE_URL` constant. This enables direct mutation of `import.meta.env` in tests.
- Created `bunfig.toml` at repo root with `[test] root = "./src"` to prevent Bun's native test runner from picking up Vitest-only React tests in `web/src/`.
- Single `tsconfig.json` (no project references); `vite-env.d.ts` provides `vite/client` types for `import.meta.env` and CSS imports.
- Used code-based TanStack Router (not file-based); exported both `routeTree` and `router` from `router.tsx` so tests can create isolated router instances.

## Learnings

- `@testing-library/jest-dom` v6 requires `expect` to be globally available; `globals: true` + `"types": ["vitest/globals"]` is the correct setup with Vitest 4.
- `import.meta.env` in Vitest jsdom is a mutable plain object — safe to delete/set properties in tests to control the value read by functions.
- `bun test` from workspace root sweeps `web/` despite the `src/` arg; `bunfig.toml` `root = "./src"` is the correct scope restriction.
- `vite-env.d.ts` (with `/// <reference types="vite/client" />`) fixes both `import.meta.env` typing and CSS side-effect import TS errors.
- Installed versions: vite@8.0.14, vitest@4.1.7, typescript@6.0.3, react@19.2.6, @tanstack/react-router@1.170.10, @tanstack/react-query@5.100.14, tailwindcss@4.3.0, msw@2.14.6.

## Files / Surfaces

Created:
- `web/package.json` — real scripts (dev/build/typecheck/test), deps + devDeps
- `web/vite.config.ts` — Vite + Vitest + coverage config
- `web/tsconfig.json` — single tsconfig, includes src/ and test/
- `web/index.html` — app entry
- `web/components.json` — shadcn config (new-york style, zinc base, cssVariables)
- `web/src/vite-env.d.ts` — vite/client types reference
- `web/src/index.css` — Tailwind v4 + shadcn CSS variables (oklch colors)
- `web/src/main.tsx` — app entry (QueryClientProvider wrapping RouterProvider)
- `web/src/router.tsx` — TanStack Router code-based, exports routeTree + router
- `web/src/lib/config.ts` — VITE_API_BASE_URL config with getApiBaseUrl()
- `web/src/lib/utils.ts` — shadcn cn() helper
- `web/src/lib/config.test.ts`, `web/src/lib/utils.test.ts`
- `web/src/__tests__/App.test.tsx`, `web/test/msw.test.ts`
- `web/test/setup.ts` — RTL + MSW bootstrap, exports server
- Directory stubs: src/stores/, src/features/, src/components/ui/, src/lib/api/, src/lib/ws/
Modified:
- `bunfig.toml` (created at root) — restricts bun test to ./src

## Errors / Corrections

1. `@testing-library/jest-dom` threw `expect is not defined` → fix: `globals: true` in vitest config.
2. TypeScript errors: `import.meta.env` not typed, CSS import error → fix: `web/src/vite-env.d.ts`.
3. Root `bun test` picked up web's React tests (no jsdom) → fix: `bunfig.toml` root restriction.

## Ready for Next Run

Task 04 is complete. Tasks 05–11 can now proceed — providers, layout, and test harness are in place.
