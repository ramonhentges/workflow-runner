# Workflow Runner Web UI — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Monorepo tooling: Bun workspaces + Turborepo | done | medium | — |
| 02 | Backend: env-gated CORS + WS Origin allowlist extension | done | medium | — |
| 03 | Backend: GET /workflows?cwd= listing endpoint | done | medium | — |
| 04 | Web app skeleton (Vite/React/Router/Tailwind/shadcn/Query/Vitest) | done | high | task_01 |
| 05 | Web: wire types + HTTP API client | done | medium | task_04 |
| 06 | Web: WS attach client + view-model reducer | done | high | task_05 |
| 07 | Web: Zustand cwd store + cwd switcher UI | done | medium | task_04 |
| 08 | Web: Dashboard (Query hooks + runs table) | done | medium | task_05, task_07 |
| 09 | Web: Start-run flow (workflow picker + manual path) | done | medium | task_03, task_05, task_07 |
| 10 | Web: Live run view (WS hook + transcript + controls + summary) | done | high | task_06 |
| 11 | Web: Routing + app shell composition | done | medium | task_07, task_08, task_09, task_10 |
