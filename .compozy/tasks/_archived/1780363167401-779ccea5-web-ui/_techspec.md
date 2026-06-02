# TechSpec: Workflow Runner Web UI

## Executive Summary

The web UI is a new React single-page app delivered as a `web/` workspace in a Bun-workspaces + Turborepo monorepo, with the existing runner left in place at the repository root (ADR-002, ADR-003). It consumes the daemon's existing HTTP/WS API over loopback from its own origin; the daemon's security layer is extended — gated by `WORKFLOW_RUNNER_UI_ORIGIN` — to admit the UI origin for WS upgrades and to send CORS headers for cross-origin HTTP (ADR-004). The UI is built with Vite + TanStack Router + shadcn; **TanStack Query** owns server state while **Zustand** owns the browser-persisted cwd list and client UI state, and a dedicated **WebSocket client** reduces the live `/runs/:id/attach` frame stream into a transcript/step/status view model (ADR-005). One small backend addition, `GET /workflows?cwd=`, powers the workflow picker (ADR-006).

**Primary trade-off:** choosing a separate UI origin (over same-origin serving from the daemon) keeps the two projects operationally independent and simple to develop, at the cost of widening the daemon's security surface (env-gated CORS + an extra allowed Origin) and introducing one duplicated set of wire types in the web package. We accept this duplication and the additional security branch in exchange for a decoupled build and faster iteration.

## System Architecture

### Component Overview

**New — `web/` package (frontend):**
- **App shell + router** (TanStack Router): persistent shell hosting the cwd switcher and dashboard; routes for dashboard (`/`), start-run (`/start`), and focused run (`/runs/$runId`).
- **API client** (`web/src/lib/api`): typed `fetch` wrappers for `GET /runs`, `GET /runs/:id`, `GET /workflows`, `GET /health`, `POST /runs`, `POST /runs/:id/stop`, `POST /runs/:id/retry-step`, plus redeclared wire types + minimal zod frame validators.
- **WS attach client** (`web/src/lib/ws`): opens `/runs/:id/attach`, parses `AttachFrame`s, and reduces them into a run view model (snapshot, ordered transcript, status, interactive flag, summary).
- **Server-state layer** (TanStack Query): query hooks for dashboard/detail/workflows/health; mutation hooks for start/stop/retry that invalidate the relevant queries.
- **Client-state layer** (Zustand): `cwdStore` (persisted cwd list + active cwd) and `uiStore` (transient UI).
- **Feature UIs** (shadcn components): dashboard table, cwd switcher, start-run form, live run view (transcript + step progress + inline controls + summary panel).

**Modified — runner package (`src/app/api/`, backend):**
- `security.ts` + `app.ts`: env-gated CORS middleware and extended WS Origin allowlist (ADR-004).
- New `routes/workflows.ts` + `schema.ts` entry: `GET /workflows?cwd=` (ADR-006).

**Data flow:** Browser → (HTTP, TanStack Query) → daemon REST for lists/detail/start/stop/retry/workflow-listing. Browser → (WebSocket) → daemon `/runs/:id/attach` for the live stream and `input` frames. The active cwd from `cwdStore` parameterizes `GET /runs?cwd=`, `GET /workflows?cwd=`, and the `POST /runs` body.

## Implementation Design

### Core Interfaces

Wire types mirror `src/app/api/schema.ts`. The `RunnerEvent` union mirrors `src/domain/runner.ts` (the `event` field that `schema.ts` leaves as `unknown`):

```ts
// web/src/lib/api/types.ts
export type RunStatus = "running" | "completed" | "failed" | "crashed" | "aborted";

export type RunnerEvent =
  | { type: "banner"; step: { id: string }; index: number }
  | { type: "log"; message: string; color?: string }
  | { type: "stream"; kind: string; chunk: string; color?: string }
  | { type: "interactive"; enabled: boolean }
  | { type: "status"; text: string; color?: string }
  | { type: "summary"; summary: unknown };

export interface RunEvent { seq: number; ts: number; stepId: string | null; event: RunnerEvent; }

export type AttachFrame =
  | { type: "snapshot"; snapshot: RunDetail }
  | { type: "backlog"; entries: RunEvent[]; truncated: boolean }
  | { type: "event"; entry: RunEvent }
  | { type: "status"; status: RunStatus }
  | { type: "error"; code: string; message: string };
```

The WS client and its reduced view model:

```ts
// web/src/lib/ws/attach-client.ts
export interface RunViewModel {
  snapshot: RunDetail | null;
  transcript: TranscriptItem[];   // stream chunks coalesced by (stepId, kind)
  steps: { id: string; index: number; active: boolean }[]; // from banner events
  status: RunStatus | null;
  interactiveEnabled: boolean;
  summary: unknown | null;
  error: { code: string; message: string } | null;
}

export interface AttachClient {
  subscribe(onModel: (vm: RunViewModel) => void): () => void; // returns unsubscribe
  sendInput(message: string): void;   // emits {type:"input",message}
  close(): void;                       // closes the socket; no reconnect (MVP)
}
export function openAttach(runId: string, baseWsUrl: string): AttachClient;
```

The persisted client store:

```ts
// web/src/stores/cwd-store.ts
export interface Cwd { id: string; label: string; path: string; }
export interface CwdState {
  cwds: Cwd[];
  activeCwdId: string | null;
  addCwd(label: string, path: string): void;
  removeCwd(id: string): void;
  setActive(id: string): void;
  activeCwd(): Cwd | null;
}
// created via create<CwdState>()(persist(..., { name: "wfr.cwds" }))
```

### Data Models

- **Cwd** (client-only, persisted to `localStorage` key `wfr.cwds`): `{ id, label, path }` + `activeCwdId`.
- **Server wire types** (consumed read-only, defined in `schema.ts`): `RunSummary`, `RunDetail`, `RunEvent`, `AttachFrame`, `InputFrame`, `StartRunRequest`, `HealthReport`.
- **New `WorkflowListSchema`** (added to `schema.ts`, ADR-006): `{ workflows: { name: string; path: string }[] }`.
- **TranscriptItem** (client-only, derived): `{ kind: "step" | "message" | "log" | "status"; stepId: string | null; text: string; seqStart: number; seqEnd: number }`.

No database; the web app holds no persistent server data of its own.

### API Endpoints

Existing (consumed as-is):

| Method | Path | Use |
|---|---|---|
| GET | `/runs?cwd=&all=` | Dashboard list, filtered by active cwd. |
| GET | `/runs/:id` | Run detail snapshot. |
| GET | `/runs/:id/events?fromSeq=&stepId=` | Historical events (not required by MVP view; available). |
| POST | `/runs` | Start a run `{ workflowPath, cwd }`. |
| POST | `/runs/:id/stop` | Stop a run. |
| POST | `/runs/:id/retry-step` | Retry failing step. |
| GET | `/health` | Daemon liveness (header/status indicator). |
| WS | `/runs/:id/attach[?fromSeq=N]` | Live frames + `input` frames. |

New (this effort):

| Method | Path | Request | Response | Codes |
|---|---|---|---|---|
| GET | `/workflows?cwd=<dir>` | `cwd` query (required) | `{ workflows: [{ name, path }] }` | 200; 400 missing/invalid cwd |

## Integration Points

The only external system is the **workflow-runner daemon API** (loopback). The web app reaches it cross-origin:
- **Auth:** none (loopback, single-user); CORS is origin-reflected for `WORKFLOW_RUNNER_UI_ORIGIN` with credentials disabled.
- **Discovery:** the browser uses `VITE_API_BASE_URL` (default `http://127.0.0.1:4517`); it does not read `daemon.json`.
- **Error handling:** HTTP errors surface as query/mutation errors → inline error UI; WS `error` frames render in the run view without tearing down the page; WS close (idle/shutdown/overflow) ends the live view with a notice. No automatic reconnect in the MVP.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|---|---|---|---|
| Root `package.json` / `turbo.json` | new/modified | Becomes workspace root; adds `web` workspace + turbo pipelines. Low risk if runner scripts preserved. | Add workspaces field, turbo config; verify runner tasks unchanged. |
| `web/` package | new | Entire React app. Net-new; isolated. | Build per ADR-003/005. |
| `src/app/api/security.ts` | modified | Add env-gated CORS + extra allowed Origin. Medium risk: widens surface if env set. | Implement origin branch + CORS middleware; default-closed. |
| `src/app/api/app.ts` | modified | Wire CORS middleware; register workflows route. | Register middleware + route. |
| `src/app/api/routes/ws-attach.ts` | modified | Origin check honours configured UI origin. | Update pre-upgrade Origin check. |
| `src/app/api/routes/workflows.ts` | new | New listing endpoint. | Implement + tests + OpenAPI entry. |
| `src/app/api/schema.ts` | modified | Add `WorkflowListSchema`. | Add schema; cover in completeness test. |

## Testing Approach

### Unit Tests
- **Web (Vitest + RTL + MSW):** WS view-model reducer (stream coalescing, banner→step, status/summary handling) tested as a pure function; `cwdStore` actions + persistence; API client wrappers; dashboard table rendering across statuses; start-run form (workflow pick + manual path); live run view (interactive input enable/disable, inline stop/retry availability by status, summary panel). MSW mocks the REST API; a fake `WebSocket` drives frame sequences.
- **Backend (`bun test`):** `GET /workflows` — happy path, missing folder (empty list), missing/invalid cwd (400), no traversal beyond `<cwd>/workflows`. `security.ts` — Origin allowed/blocked with and without env var; CORS headers present only when configured.

### Integration Tests
- **Backend:** extend `src/app/api/` route tests via `app.request()` for the new endpoint and the OpenAPI completeness/conformance tests (`schema.test.ts`, `openapi-completeness.test.ts`).
- **Web:** feature-level RTL tests wiring router + Query + MSW for the full flows (add cwd → start run → see run view; stop/retry reflects status). Live WS exercised via the fake socket; no real daemon required.

## Development Sequencing

### Build Order
1. **Monorepo scaffolding** — root `turbo.json`, Bun workspaces, `web/` package skeleton (Vite + React + TS + TanStack Router + Tailwind/shadcn + Zustand + TanStack Query + Vitest/RTL/MSW). No dependencies.
2. **Backend: security + workflows endpoint** — env-gated CORS + WS Origin allowlist extension; `GET /workflows?cwd=` + `WorkflowListSchema` + tests + OpenAPI entry. Independent of the web app; depends on nothing.
3. **API client + WS client + wire types** (`web/src/lib`) — typed fetch wrappers, redeclared types/zod, `openAttach` + view-model reducer. Depends on step 1 (scaffold) and step 2 (endpoints/CORS to run against).
4. **Zustand cwd store + cwd switcher UI** — persisted store + switcher in the app shell. Depends on step 1.
5. **TanStack Query setup + Dashboard** — query hooks; runs table with `?cwd` filter and `?all` toggle; auto-refetch. Depends on steps 3 and 4.
6. **Start-run flow** — workflow picker (via `GET /workflows`) + manual path, `POST /runs` mutation, navigate into the new run. Depends on steps 3, 4, 5.
7. **Live run view** — WS attach hook + transcript + step-progress indicator + interactive input + inline stop/retry mutations + final summary panel. Depends on steps 3 and 5.
8. **Routing + app shell wiring** — finalize TanStack Router routes (`/`, `/start`, `/runs/$runId`) and shell composition. Depends on steps 4, 5, 6, 7.
9. **Test hardening** — fill remaining Vitest/RTL/MSW coverage across features. Depends on steps 5–8.

### Technical Dependencies
- Bun + Turborepo available in the environment.
- A running daemon (with `WORKFLOW_RUNNER_UI_ORIGIN` set) for manual/integration verification; automated web tests mock it.

## Monitoring and Observability

This is a local single-user dev tool; no production telemetry. Operationally:
- The app surfaces daemon reachability via `GET /health` (a header status indicator) and shows clear error states for failed HTTP calls and WS disconnects (close code/reason).
- Browser devtools/console are the debugging surface; structured app logging is out of scope.

## Technical Considerations

### Key Decisions
- **Separate UI origin + env-gated allowlist/CORS** (ADR-004). Rationale: operational independence; default-closed security. Trade-off: extra security branch + CORS. Rejected: same-origin serving from the daemon.
- **Bun workspaces + Turborepo, runner stays at root** (ADR-003). Rationale: single toolchain, minimal disruption. Trade-off: root is both package and workspace root. Rejected: pnpm; `apps/runner` restructure.
- **TanStack Query + Zustand + dedicated WS client** (ADR-005). Rationale: right tool per state nature. Trade-off: one extra library + duplicated wire types. Rejected: Zustand-only; router loaders; shared types package.
- **`GET /workflows?cwd=` listing endpoint** (ADR-006). Rationale: completes the picker UX. Trade-off: new endpoint. Rejected: manual-path-only.
- **Web testing: Vitest + RTL + MSW.** Rationale: idiomatic for Vite/React; isolates UI from a live daemon. Trade-off: differs from the runner's `bun test`.
- **Step progress derived from `banner` events + `visitedStepIds`.** The full step DAG/total count needs the workflow definition (a non-goal); the MVP shows an ordered breadcrumb of entered steps with the current one active.

### Known Risks
- **Wire-type drift** between `web/src/lib/api` and `schema.ts` (medium). Mitigation: minimal redeclared types; `openapi.json` as cross-check.
- **CORS/WS misconfiguration** across two env vars (medium). Mitigation: document `WORKFLOW_RUNNER_UI_ORIGIN` + `VITE_API_BASE_URL` together; sane defaults.
- **Turborepo + Bun workspaces maturity** (low). Mitigation: simple pipelines; validate at setup.
- **No reconnect/resume** (low, accepted). A dropped socket ends the live view; the user re-opens the run. `fromSeq` resume is deferred to Phase 2.

## Architecture Decision Records

- [ADR-001: Web UI product shape — Operator Console](adrs/adr-001.md) — Single-user local control plane (cwd switcher + dashboard + focused run view); no authoring/graph in MVP.
- [ADR-002: Restructure repository into a Turborepo monorepo with a separate web app](adrs/adr-002.md) — Runner + web UI as sibling workspace packages.
- [ADR-003: Bun workspaces + Turborepo with the runner at root and `web/` as a sibling](adrs/adr-003.md) — Single Bun toolchain; root is workspace root; web app in `web/`.
- [ADR-004: Serve the web UI from its own origin; admit it via an env-gated allowlist + CORS](adrs/adr-004.md) — Separate origin; extend daemon Origin allowlist + add CORS, gated by `WORKFLOW_RUNNER_UI_ORIGIN`.
- [ADR-005: Frontend data architecture](adrs/adr-005.md) — TanStack Query (server) + Zustand (client/cwd) + dedicated WS client with a reduced view model.
- [ADR-006: Add `GET /workflows?cwd=` to list workflow files for a working directory](adrs/adr-006.md) — Small daemon endpoint listing `<cwd>/workflows/*.json`.
