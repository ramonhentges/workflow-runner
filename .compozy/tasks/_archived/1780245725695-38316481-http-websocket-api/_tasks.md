# HTTP + WebSocket API for the workflow-runner daemon — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Shared API Zod schemas, dependencies, and round-trip conformance test | done | medium | — |
| 02 | Thread explicit cwd through run start (RunManager + JSON-RPC + CLI) | done | medium | — |
| 03 | HTTP app harness: Bun/Hono mount, OpenAPI, error-map, speciation guard | done | medium | task_01 |
| 04 | GET /health endpoint | done | low | task_01, task_03 |
| 05 | GET /runs (list active + recent) | done | low | task_01, task_03 |
| 06 | GET /runs/:id (detail, id/slug-prefix resolution) | done | low | task_01, task_03 |
| 07 | POST /runs (start with workflowPath + required cwd) | done | medium | task_01, task_02, task_03 |
| 08 | POST /runs/:id/stop | done | low | task_01, task_03 |
| 09 | POST /runs/:id/retry-step | done | low | task_01, task_03 |
| 10 | GET /runs/:id/events (historical pull, fromSeq/stepId) | done | medium | task_01, task_03 |
| 11 | Loopback security middleware (Host/Origin) + DNS-rebind test | done | medium | task_03 |
| 12 | WebSocket attach + send handler (lean frames, fromSeq resume, guardrails) | done | high | task_01, task_03, task_11 |
| 13 | Listener mount + bind assertion + discovery file + no-regression test | done | high | task_03, task_11, task_12 |
| 14 | Graceful shutdown drain (WS + listener + discovery cleanup) | done | medium | task_13 |
| 15 | WS protocol doc + README E2E update + OpenAPI-served verification | done | low | task_10, task_12, task_13 |
