---
status: completed
title: "Web app skeleton (Vite/React/Router/Tailwind/shadcn/Query/Vitest)"
type: frontend
complexity: high
dependencies:
    - task_01
---

# Task 04: Web app skeleton (Vite/React/Router/Tailwind/shadcn/Query/Vitest)

## Overview
Scaffold the `web/` package into a runnable React single-page app with the mandated stack and the test harness, so feature tasks have a foundation to build on. This delivers the providers (router, TanStack Query) and the Vitest + RTL + MSW setup, plus one placeholder route to prove the app boots.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The `web/` package MUST build and run under Vite with React + TypeScript, installed via the Bun workspace.
- TanStack Router MUST provide the routing shell with at least one placeholder route that renders.
- A TanStack Query `QueryClientProvider` MUST wrap the app so feature tasks can register query/mutation hooks.
- Tailwind CSS and shadcn MUST be initialized so feature tasks can add components.
- A Vitest + React Testing Library + MSW harness MUST be configured and runnable via the workspace `test` task.
- The API base URL MUST be read from `VITE_API_BASE_URL` (default `http://127.0.0.1:4517`) via a single config module.

## Subtasks
- [x] 04.1 Initialize Vite + React + TypeScript in `web/` with the package name from task_01.
- [x] 04.2 Set up TanStack Router with a root route and a placeholder index route.
- [x] 04.3 Add the `QueryClientProvider` and a shared `QueryClient`.
- [x] 04.4 Initialize Tailwind + shadcn (base config, theme, `components/ui` location).
- [x] 04.5 Configure Vitest + RTL + MSW (test setup file, jsdom environment, MSW server bootstrap).
- [x] 04.6 Add the `VITE_API_BASE_URL` config module with its default.

## Implementation Details
Build per TechSpec "System Architecture" (Component Overview) and "Development Sequencing" step 1, and ADR-005. Establish the directory layout the later tasks assume: `web/src/main.tsx`, `web/src/router.tsx` (or routes dir), `web/src/lib/` (config, api, ws — populated later), `web/src/stores/`, `web/src/features/`, `web/src/components/ui/`. Keep the placeholder route trivial; real features land in tasks 07–11.

### Relevant Files
- `web/package.json` — replace the task_01 placeholder with real deps/scripts (`dev`, `build`, `typecheck`, `test`).
- `web/vite.config.ts` — Vite + Vitest config.
- `web/index.html`, `web/src/main.tsx` — app entry.
- `web/src/router.tsx` — TanStack Router setup + placeholder route.
- `web/src/lib/config.ts` — `VITE_API_BASE_URL` resolution.
- `web/test/setup.ts` — RTL + MSW bootstrap.

### Dependent Files
- `turbo.json` — its `dev`/`build`/`typecheck`/`test` pipelines now exercise the `web` tasks.

### Related ADRs
- [ADR-003: Bun workspaces + Turborepo](../adrs/adr-003.md) — Package lives in `web/` under the workspace.
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — Establishes Query provider + Zustand directory + WS-client location used by later tasks.

## Deliverables
- A runnable `web/` SPA with router + Query provider + Tailwind/shadcn initialized.
- Vitest + RTL + MSW harness wired to the workspace `test` task.
- `lib/config.ts` resolving the API base URL.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test that the app boots and renders the placeholder route **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `lib/config.ts` returns `http://127.0.0.1:4517` when `VITE_API_BASE_URL` is undefined and the override when set.
  - [x] The MSW server starts/stops cleanly in the test setup (a sample mocked request resolves).
- Integration tests:
  - [x] Rendering the app mounts the router and shows the placeholder index route (RTL).
  - [x] `turbo run test --filter=@workflow-runner/web` (or workspace `test`) executes the Vitest suite (exit 0).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `bun run dev` (web) serves the placeholder app; `build` and `typecheck` succeed.
- The directory layout and providers required by tasks 05–11 are in place.
