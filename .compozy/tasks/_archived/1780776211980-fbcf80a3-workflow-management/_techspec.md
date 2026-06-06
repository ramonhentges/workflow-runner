# TechSpec: Workflow Management (Create, Edit, Delete)

Implements the PRD at `_prd.md`. Business context (WHAT/WHY) lives there; this
document covers HOW.

## Executive Summary

This feature adds workflow CRUD to the daemon's HTTP API and a new web feature
module that consumes it. On the server, three concerns are added behind the
existing Hono + `@hono/zod-openapi` surface: (1) **filename-addressed CRUD
routes** under the `/workflows` resource that read/write `*.json` files in
`<cwd>/workflows`, reusing the domain `Workflow.fromJson` validator so saved
files are always runnable (ADR-004); (2) a **run-aware guard** that blocks delete
and rename while a run of that workflow is live, by consulting the in-process
`RunManager`; and (3) a **live IDE catalog probe** (`GET /ide/{ide}/catalog`)
that spawns the selected IDE over ACP, reads its agents and models from one
`newSession` response, and degrades gracefully to `reachable:false` (ADR-005).
On the web, a `features/workflows` module adds list/create/edit/delete pages
built with react-hook-form + zod (ADR-006), with an agent/model combobox backed
by the catalog endpoint that always allows free-text entry.

**Primary trade-off:** the catalog probe spawns a real IDE subprocess per
request — slower and dependent on local installation/auth — in exchange for a
catalog that exactly reflects what the selected IDE supports, with manual entry
as the always-available fallback. We also accept last-write-wins on concurrent
edits and no draft persistence (server enforces validity), appropriate for a
local single-user tool.

## System Architecture

### Component Overview

Server (runs inside the daemon process, which already owns `RunManager`):

- **Workflow CRUD routes** (`src/app/api/routes/workflow-crud.ts`, new) — read-one,
  create, update/rename, delete. Pure filesystem operations over
  `<cwd>/workflows`, plus domain validation on write. Delete/rename depend on the
  run guard. The existing `workflows.ts` (list) is unchanged.
- **Run guard** (small helper, colocated with CRUD or in `RunManager`) — given a
  `cwd` + workflow filename, asks `RunManager.list()` whether any `running` run
  has a matching `workflowPath`; used to block delete/rename.
- **IDE catalog probe** (`src/infra/acp/ide-catalog.ts`, new) — `probeIdeCatalog`
  reuses `resolveIdeProfile` + spawn/ACP-connect/dispose to read agents
  (`availableModeIds`) and models (`newSession().models.availableModels`).
- **IDE catalog route** (`src/app/api/routes/ide-catalog.ts`, new) — wraps the
  probe with a timeout and the graceful `reachable` envelope.
- **Schemas** (`src/app/api/schema.ts`, modified) — request/response zod schemas
  for the new endpoints.

Web (`web/src/`):

- **`features/workflows/`** (new) — `WorkflowList`, `WorkflowEditor`
  (create + edit), `StepFields`, `EdgesField`, `AgentModelPicker`, and hooks
  (`useWorkflowList`, `useWorkflow`, `useIdeCatalog`, mutation hooks).
- **API client** (`web/src/lib/api/client.ts`, modified) — `getWorkflow`,
  `createWorkflow`, `updateWorkflow`, `deleteWorkflow`, `getIdeCatalog`.
- **Routing/nav** (`web/src/router.tsx`, `web/src/app/AppShell.tsx`, modified) —
  `/workflows`, `/workflows/new`, `/workflows/$name/edit`; a "Workflows" nav link.

### Data Flow

- **List/edit:** web reads active `cwd` from `cwd-store` → `GET /workflows` (list)
  / `GET /workflows/{name}` (one) → render form.
- **Save:** editor validates with zod → `POST` / `PUT` with `{ name, workflow }`
  → server validates with `Workflow.fromJson` → atomic write → 201/200.
- **Discovery:** on IDE selection, `useIdeCatalog(ide)` → `GET /ide/{ide}/catalog?cwd=`
  → probe spawns IDE → agents/models populate the combobox (or `reachable:false`
  → manual only).
- **Delete:** `DELETE /workflows/{name}` → run guard checks `RunManager` → 409 if
  live, else remove → web invalidates the list query.

## Implementation Design

### Core Interfaces

The probe is the primary new type other components depend on:

```ts
// src/infra/acp/ide-catalog.ts
export interface IdeCatalogEntry {
  id: string;
  name: string;
}

export interface IdeCatalog {
  reachable: boolean;
  agents: IdeCatalogEntry[];
  models: IdeCatalogEntry[];
  reason?: string; // populated when reachable === false
}

// Spawns the IDE for `ide`, reads agents+models from one ACP newSession,
// disposes the subprocess. Never throws for an unreachable IDE: failures
// (spawn error, timeout, auth, malformed response) resolve to
// { reachable: false, agents: [], models: [], reason }.
export function probeIdeCatalog(
  ide: string,
  cwd: string,
  opts?: { timeoutMs?: number; spawnFn?: typeof import("node:child_process").spawn },
): Promise<IdeCatalog>;
```

Server write path reuses the existing domain validator and error mapping:

```ts
// inside POST/PUT handlers (src/app/api/routes/workflow-crud.ts)
const file = resolveWorkflowFile(cwd, name); // basename-guarded, within <cwd>/workflows
try {
  Workflow.fromJson(body.workflow); // throws WorkflowConfigError on malformed
} catch (err) {
  const { status, code, message } = mapError(err); // -> 400 WORKFLOW_INVALID
  return c.json({ code, message }, status as 400);
}
await writeJsonAtomic(file, body.workflow); // temp file + rename
```

### Data Models

Workflow JSON shape is unchanged (`src/domain/workflow.ts`: `id, name,
description, version, steps[]`; step `id, agent, model, mode, ide, description,
edges[]`). No domain changes. New API zod schemas in `src/app/api/schema.ts`:

- `WorkflowNameParamSchema` = `{ name: string }` — basename, rejects `/ \ ..`.
- `WorkflowBodySchema` = `{ name: string; workflow: unknown }` (create) and
  `{ name?: string; workflow: unknown }` (update; `name` present ⇒ rename).
- `WorkflowDocSchema` — response for read-one: `{ name, path, workflow }`.
- `IdeCatalogParamSchema` = `{ ide: string }`; `IdeCatalogSchema` =
  `{ reachable, agents: {id,name}[], models: {id,name}[], reason? }`.

The `workflow` payload is validated structurally by `Workflow.fromJson`, not by a
duplicated zod schema, to keep one source of truth (ADR-004).

### API Endpoints

| Method | Path | Description | Success | Errors |
|--------|------|-------------|---------|--------|
| GET | `/workflows?cwd=` | List `*.json` (existing, unchanged) | 200 | 400 missing/invalid cwd |
| GET | `/workflows/{name}?cwd=` | Read one (`{name}` bare, `.json` appended) | 200 `WorkflowDoc` | 400 bad name/cwd, 404 not found |
| POST | `/workflows?cwd=` | Create from `{ name, workflow }` | 201 | 400 invalid workflow/name, 409 name exists |
| PUT | `/workflows/{name}?cwd=` | Update; body `name` ⇒ rename | 200 | 400 invalid, 404 not found, 409 live run / rename target exists |
| DELETE | `/workflows/{name}?cwd=` | Delete (run-aware) | 200/204 | 404 not found, 409 live run |
| GET | `/ide/{ide}/catalog?cwd=` | Probe IDE for agents+models | 200 `IdeCatalog` | 400 unknown ide / missing cwd |

Notes: `{name}` is the bare workflow name; the server appends `.json` (per user
decision / ADR-004). Unknown `{ide}` is a 400 (distinct from `reachable:false`,
which is a normal 200). All error bodies use the existing `{ code, message }`
shape via `mapError`. A new `RpcErrorCode` (e.g. `WORKFLOW_RUN_ACTIVE` → 409) is
added for the run guard; `WORKFLOW_EXISTS` → 409 for create/rename collisions.

## Integration Points

- **IDE subprocesses over ACP** — the catalog probe spawns the same IDE binaries
  the runner uses (`opencode`, `npx @zed-industries/claude-code-acp`, etc.) via
  `IdeProfile.spawn`. Auth is whatever the local IDE already has; no credentials
  handled here. Failure/timeout → `reachable:false`. Disposal uses the existing
  SIGTERM→SIGKILL pattern.
- **RunManager** — read-only `list()` consulted by the delete/rename guard; no
  changes to run lifecycle.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/app/api/routes/workflow-crud.ts` | new | CRUD handlers; main new server surface. Med risk: path safety, atomic writes | Implement + tests |
| `src/app/api/routes/ide-catalog.ts` | new | Catalog route wrapping the probe. Low-med: timeout/graceful envelope | Implement + tests |
| `src/infra/acp/ide-catalog.ts` | new | `probeIdeCatalog`. Med: subprocess lifecycle, timeout | Implement + tests |
| `src/app/api/schema.ts` | modified | Add request/response schemas. Low | Add schemas |
| `src/app/api/app.ts` | modified | Register new routes. Low | Wire `register*` calls |
| `src/infra/daemon/protocol.ts` | modified | Add `WORKFLOW_RUN_ACTIVE`, `WORKFLOW_EXISTS` codes + HTTP map. Low | Add codes + `ERROR_HTTP_STATUS` |
| `src/app/api/error-map.ts` | modified | Map new codes (409). Low | Extend map |
| `src/infra/daemon/run-manager.ts` | possibly modified | Optional helper to test "active run for workflow path". Low | Add read-only helper or compute in route |
| `web/src/features/workflows/*` | new | List + editor UI. Med: nested form, picker UX | Implement + tests |
| `web/src/lib/api/{client,types}.ts` | modified | New client fns + wire types. Low | Add functions/types |
| `web/src/router.tsx`, `app/AppShell.tsx` | modified | Routes + nav link. Low | Add routes/link |
| `web/package.json` | modified | Add `react-hook-form`, `@hookform/resolvers`. Low | Add deps |
| `src/app/api/openapi-completeness.test.ts` | modified | New routes must be documented. Low | Update expectations |

## Testing Approach

### Unit Tests

- **CRUD routes** (`app.request()`, no port): create→read→update→delete happy
  path; invalid workflow → 400 `WORKFLOW_INVALID`; path-traversal name (`../x`,
  `a/b`) → 400; missing `cwd` → 400; read/update/delete unknown → 404; create
  over existing → 409; rename to existing → 409. Use a temp `cwd` with a
  `workflows/` dir.
- **Run guard**: delete/rename with a stubbed `RunManager.list()` returning a
  `running` run whose `workflowPath` matches → 409 `WORKFLOW_RUN_ACTIVE`;
  non-matching or terminal runs → allowed.
- **`probeIdeCatalog`** with an injected `spawnFn`: fake ACP agent advertising
  modes + models → `reachable:true` with mapped entries; spawn error → 
  `reachable:false` + reason; never-responds → timeout → `reachable:false`;
  unknown ide → throws/`UnknownIdeError` (route turns into 400).
- **Catalog route**: `reachable:true`/`false` envelopes both return 200; unknown
  ide → 400.
- **Web**: editor zod validation (duplicate step id, edge→missing step, empty
  required) shows field errors and blocks submit; `AgentModelPicker` renders
  catalog options and accepts free text on `reachable:false`; list delete shows
  the run-active error from a 409; mutation success invalidates queries (MSW
  mocks, matching existing web test style).

### Integration Tests

- API: full create→list→read→run-via-existing-start→ (run active) delete blocked
  → stop → delete, against a temp project dir, reusing existing API test harness.
- `probeIdeCatalog` against a stub ACP server process (as in
  `agent-session.test.ts`) to exercise real ndjson framing without a real IDE.

## Development Sequencing

### Build Order

1. **Schemas + error codes** (`schema.ts`, `protocol.ts`, `error-map.ts`) — no
   dependencies. Defines the contract everything else uses.
2. **Workflow CRUD routes** (`workflow-crud.ts`) + register in `app.ts` —
   depends on step 1. Filesystem + `Workflow.fromJson`; path safety; atomic write.
3. **Run guard** for delete/rename — depends on step 2 (the routes it guards) and
   `RunManager.list()` (existing).
4. **`probeIdeCatalog`** (`ide-catalog.ts` in infra) — independent of steps 2–3;
   depends only on existing `ide-profiles`/SDK. Can be built in parallel with 2.
5. **IDE catalog route** (`ide-catalog.ts` in routes) + register — depends on
   steps 1 and 4.
6. **Web API client + types** — depends on step 1's contract (mirrors wire shapes).
7. **Web `workflows` feature: list + delete** — depends on step 6 and routes from
   steps 2/3. Adds `/workflows` route + nav link.
8. **Web editor (create/edit) with react-hook-form + zod** — depends on steps 6
   and 2; adds `/workflows/new` and `/workflows/$name/edit`.
9. **Web agent/model picker wired to catalog** — depends on steps 5, 6, and 8.
10. **OpenAPI completeness + integration tests + docs (README/CLAUDE.md)** —
    depends on all prior steps.

### Technical Dependencies

- `react-hook-form` + `@hookform/resolvers` added to `web/package.json` before
  step 8.
- For catalog integration tests, a stub ACP agent process (pattern already exists
  in `agent-session.test.ts`).
- No infrastructure or external-service dependencies; the daemon already hosts
  the API and owns `RunManager`.

## Monitoring and Observability

- Reuse the daemon's existing logging. Log catalog probes with structured fields:
  `ide`, `cwd`, `outcome` (`reachable`/`unreachable`), `reason`, `durationMs`.
- Log workflow writes/deletes at info with `cwd`, `name`, `action`, and outcome;
  log 409 run-guard blocks so the operator can see why a delete was refused.
- No new metrics backend; `GET /health` already reports `activeRuns`. Probe
  timeout count is observable via logs.

## Technical Considerations

### Key Decisions

- **Decision:** filename-addressed CRUD with server-side `Workflow.fromJson`
  validation (ADR-004). **Rationale:** matches the path-based runner and existing
  list; one validation source of truth. **Trade-off:** no draft persistence; two
  name forms (`who-is` vs `who-is.json`). **Rejected:** id-based addressing,
  lenient save.
- **Decision:** single graceful catalog endpoint via a purpose-built minimal ACP
  probe (ADR-005). **Rationale:** accurate, non-blocking, reuses dispose
  semantics. **Trade-off:** subprocess cost per request. **Rejected:** error
  status on failure, split endpoints, reusing the full `AgentSession`.
- **Decision:** react-hook-form + zod in a `features/workflows` module (ADR-006).
  **Rationale:** `useFieldArray` fits the nested step/edge arrays. **Trade-off:**
  a second form paradigm + one dependency. **Rejected:** plain useState.

### Known Risks

- **Path traversal** (med likelihood, high impact). *Mitigation:* strict basename
  validation + containment check against resolved `<cwd>/workflows`; covered by
  tests with `../` and separator inputs.
- **Hung/slow IDE probe** (med). *Mitigation:* hard timeout + SIGTERM→SIGKILL
  dispose; graceful `reachable:false`.
- **Web/server validation drift** (med). *Mitigation:* server authoritative;
  treat 400 `WORKFLOW_INVALID` as truth; keep web zod minimal; test both.
- **Concurrent edits / last-write-wins** (low for single-user). *Mitigation:*
  atomic temp-file+rename write to avoid partial files; multi-writer coordination
  out of scope.

## Architecture Decision Records

PRD-phase:

- [ADR-001: Form-based workflow authoring now, visual canvas deferred](adrs/adr-001.md) — Ship the form editor; defer the canvas to a later phase that reuses the node-config form.
- [ADR-002: Live per-IDE discovery of agents and models, with manual override](adrs/adr-002.md) — Probe the IDE on demand; always allow manual entry; no caching.
- [ADR-003: Run-aware deletion — block while running, plain confirm otherwise](adrs/adr-003.md) — Refuse delete/identity edits during a live run; standard confirm otherwise, no history warning.

TechSpec-phase:

- [ADR-004: Filename-addressed REST workflow CRUD with server-side domain validation](adrs/adr-004.md) — Bare-name URLs (`.json` appended), reuse `Workflow.fromJson`, reject malformed with 400.
- [ADR-005: Live IDE catalog discovery via a lightweight ACP probe, graceful by design](adrs/adr-005.md) — One `GET /ide/{ide}/catalog` probe; failures resolve to a 200 `reachable:false` envelope.
- [ADR-006: react-hook-form + zod for the step editor; web `workflows` feature module](adrs/adr-006.md) — Nested form via `useFieldArray`; isolated `features/workflows` module.
