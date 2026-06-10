# TechSpec: Manage global workflows from the web

> Implements [PRD: Manage global workflows from the web](_prd.md).

## Executive Summary

Global workflows are introduced as a **scope** dimension layered onto the
existing project-scoped workflow API, not as a parallel subsystem. Files live in
a single user-level directory under the daemon's existing storage root
(`(XDG_STATE_HOME ?? ~/.local/state)/workflow-runner/workflows/`), resolved
without any `cwd`. The list and CRUD routes gain a `scope` discriminator:
`GET /workflows?cwd=` merges project and global items server-side into one
array, each tagged with `scope`; the CRUD routes accept `?scope=global|project`
(defaulting to `project` for back-compat). The run layer is untouched — it
already accepts any absolute `workflowPath` plus any `cwd`, so a global run is
simply the global file's path run against the active working directory.

The primary trade-off: extending the existing single route tree with a `scope`
discriminator makes the list handler read two directories and threads a new
field through every workflow consumer (schema, web types, client, components),
in exchange for one combined server response, full back-compatibility, and
reuse of all existing file helpers, name validation, and the run-active guard.
This was chosen over a parallel `/global-workflows` route tree, which would
duplicate four handlers and push merge logic into the client (see ADR-003).

## System Architecture

### Component Overview

**Server (`src/`)**

- **`resolveGlobalWorkflowsDir` (new helper, `workflow-crud.ts`)** — returns the
  global workflows directory from the daemon storage root (ADR-002). Mirrors
  `resolveStorageRoot` in `run-store.ts`.
- **`resolveScopedWorkflowsDir(scope, cwd, env)` (new helper)** — selects between
  the global directory and `<cwd>/workflows` based on scope. Single source of
  truth for directory resolution across list and CRUD.
- **`workflows.ts` (list route, modified)** — reads both the project directory
  (when `cwd` present) and the global directory, tags each entry with its scope,
  and returns the concatenated array.
- **`workflow-crud.ts` (modified)** — `GET/POST/PUT/DELETE /workflows/:name`
  read `scope` from the query and resolve their target directory via
  `resolveScopedWorkflowsDir`. All other logic (name validation, atomic write,
  409 conflict, run-active guard) is unchanged.
- **`schema.ts` (modified)** — adds `WorkflowScopeSchema`, a `scope` field on
  `WorkflowItemSchema`, and an optional `scope` on the workflow query schema.

**Web (`web/src/`)**

- **`lib/api/types.ts` + `lib/api/client.ts` (modified)** — `WorkflowItem` gains
  `scope`; `listWorkflows`/`getWorkflow`/`createWorkflow`/`updateWorkflow`/
  `deleteWorkflow` accept and forward `scope`.
- **`features/workflows/WorkflowList.tsx` (modified)** — renders one combined
  list, a scope badge per row, keyed by `scope + name`.
- **`features/workflows/WorkflowEditor.tsx` + `StepFields`/form (modified)** —
  a Global/Project scope toggle on create (default Project); read-only badge on
  edit; edits preserve scope.
- **`features/workflows/useWorkflowList.ts` / `useWorkflow.ts` (modified)** —
  thread `scope` through query keys and fetch calls.
- **`features/start-run/StartRunForm.tsx` + `useWorkflows.ts` (modified)** —
  the workflow picker shows scoped items; starting a run passes the selected
  item's absolute `path` as `workflowPath` and the active cwd as `cwd` (no new
  logic — the existing path-based start already handles it).

**Data flow (run a global workflow):** Web picker (global item, carries absolute
`path`) → `POST /run` `{ workflowPath: <global path>, cwd: <active cwd> }` →
`RunManager.startRun` → `Workflow.load(workflowPath)` → run executes in the
active cwd. Unchanged from project runs.

## Implementation Design

### Core Interfaces

The primary type other components depend on is the scoped workflow item. Server
schema (Zod, `src/app/api/schema.ts`):

```typescript
export const WorkflowScopeSchema = z.enum(["global", "project"]);
export type WorkflowScope = z.infer<typeof WorkflowScopeSchema>;

// WorkflowItemSchema gains `scope`; the query schema gains optional `scope`.
export const WorkflowItemSchema = z.object({
  name: z.string(),
  path: z.string(),
  scope: WorkflowScopeSchema,
});

export const WorkflowsQuerySchema = z.object({
  cwd: z.string().optional(),
  scope: WorkflowScopeSchema.optional(), // CRUD: defaults to "project"
});
```

Directory resolution helper (`src/app/api/routes/workflow-crud.ts`):

```typescript
// Global dir from the daemon storage root (ADR-002), cwd-independent.
export function resolveGlobalWorkflowsDir(env = process.env): string {
  const stateHome = env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  return join(stateHome, "workflow-runner", "workflows");
}

// Single source of truth for directory selection by scope.
export function resolveScopedWorkflowsDir(
  scope: WorkflowScope,
  cwd: string | undefined,
  env = process.env,
): string {
  if (scope === "global") return resolveGlobalWorkflowsDir(env);
  if (!cwd) throw new WorkflowConfigError("cwd is required for project scope");
  return join(resolve(cwd), "workflows");
}
```

### Data Models

No new persistent entities. A global workflow is the same `*.json` document as a
project workflow (validated by `Workflow.fromJson`), stored in a different
directory. Scope is **derived from location**, not persisted in the file.

- **`WorkflowItem`**: `{ name: string; path: string; scope: "global" | "project" }`
  — list element (server and web).
- **`WorkflowList`**: `{ workflows: WorkflowItem[] }` — combined, both scopes.
- **CRUD query**: `{ cwd?: string; scope?: "global" | "project" }` (default
  `project`).
- **Create/Update/Doc** bodies and responses are unchanged except that responses
  carry the resolved `scope`.

### API Endpoints

| Method | Path | Scope handling |
|--------|------|----------------|
| GET | `/workflows?cwd=` | Returns project (requires `cwd`) **and** global items, each tagged `scope`. Global always included. |
| GET | `/workflows/:name?scope=&cwd=` | Reads one from the scoped dir. `scope` defaults to `project`. |
| POST | `/workflows?scope=&cwd=` | Creates in the scoped dir. `409` only within that scope. |
| PUT | `/workflows/:name?scope=&cwd=` | Update/rename within the scoped dir. Run-active guard unchanged. |
| DELETE | `/workflows/:name?scope=&cwd=` | Delete from the scoped dir. Run-active guard unchanged. |

- `scope=global` ignores `cwd`; `scope=project` (or omitted) preserves current
  behavior.
- Error codes (`MISSING_CWD`, `NOT_FOUND`, `WORKFLOW_EXISTS`,
  `WORKFLOW_INVALID`, `WORKFLOW_RUN_ACTIVE`) are reused; `MISSING_CWD` applies
  only to project scope.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/app/api/schema.ts` | modified | Add `WorkflowScopeSchema`, `scope` on item + query. Low risk (additive). | Add schema fields. |
| `src/app/api/routes/workflows.ts` | modified | List reads two dirs, tags + concatenates. Medium risk (new dir read). | Implement merge. |
| `src/app/api/routes/workflow-crud.ts` | modified | Add scope-based dir resolution to all four handlers. Medium risk. | Add helpers, thread scope. |
| Run layer (`run-manager`, `run-start`) | unchanged | Already path+cwd based. No risk. | None. |
| `workflow-run-guard.ts` | unchanged | Matches by absolute path; covers global. No risk. | None (verify in tests). |
| `web/src/lib/api/{types,client}.ts` | modified | Add `scope` to type + helpers. Low risk. | Thread scope. |
| `web/.../WorkflowList.tsx` | modified | Combined list + scope badge, `scope+name` keys. Low risk. | Render badge. |
| `web/.../WorkflowEditor.tsx` + form | modified | Scope toggle on create; read-only badge on edit. Medium risk (form state). | Add toggle. |
| `web/.../useWorkflowList.ts`, `useWorkflow.ts` | modified | Thread scope through query keys/fetches. Low risk. | Update hooks. |
| `web/.../start-run/*` | modified | Picker shows scoped items; start unchanged. Low risk. | Surface scope in picker. |
| `shadcn` toggle/segmented primitive | possibly new | Scope toggle UI may need a primitive. Low risk. | Install via shadcn CLI if absent. |

## Testing Approach

### Unit Tests

- **Server (extend `workflow-crud.test.ts`, `workflows.test.ts`)** — point the
  global dir at a temp `XDG_STATE_HOME`. Cover: list merges project + global with
  correct `scope` tags; global list works with no `cwd`; create/get/update/delete
  with `scope=global`; default scope is `project`; same name in both scopes
  coexists (no false 409); `409 WORKFLOW_RUN_ACTIVE` on global delete/rename with
  an active run; path-traversal safety unchanged for global.
- **Schema (`schema.test.ts`)** — `WorkflowScopeSchema` parsing and the new
  fields; `openapi-completeness.test.ts` stays green.
- **Web (extend existing hook/component tests)** — `WorkflowList` shows the badge
  and keys by `scope+name`; editor scope toggle defaults to Project and is
  read-only on edit; client helpers append `scope` to requests.

### Integration Tests

Not added for the MVP (per the chosen testing scope). The existing
`workflow-crud.test.ts` already drives handlers through the Hono app, giving
route-level coverage; the run-against-active-cwd path is unchanged and covered by
existing run tests. Mark as a candidate if confidence requires an end-to-end
daemon test later.

## Development Sequencing

### Build Order

1. **Schema additions** (`schema.ts`) — `WorkflowScopeSchema`, `scope` on item +
   query. No dependencies.
2. **Directory-resolution helpers** (`workflow-crud.ts`) —
   `resolveGlobalWorkflowsDir`, `resolveScopedWorkflowsDir`. Depends on step 1
   (`WorkflowScope` type).
3. **CRUD handlers scope-aware** (`workflow-crud.ts`) — thread scope into all
   four handlers via step 2's helper. Depends on steps 1–2.
4. **List merge** (`workflows.ts`) — read both dirs, tag, concatenate. Depends on
   steps 1–2.
5. **Server tests** — extend route + schema tests. Depends on steps 3–4.
6. **Web API layer** (`types.ts`, `client.ts`) — add `scope` to type and CRUD
   helpers. Depends on step 1 (mirrors the contract).
7. **Web hooks** (`useWorkflowList.ts`, `useWorkflow.ts`) — thread scope through
   query keys/fetches. Depends on step 6.
8. **Web list + badge** (`WorkflowList.tsx`) — combined render, scope badge,
   `scope+name` keys. Depends on step 7.
9. **Web editor toggle** (`WorkflowEditor.tsx` + form, scope toggle/badge;
   install shadcn primitive if needed). Depends on steps 6–7.
10. **Start-run picker** surfaces scope; verify global start. Depends on steps
    7–8.
11. **Web tests** — extend hook/component tests. Depends on steps 8–10.

### Technical Dependencies

- No infrastructure or external-service dependencies.
- The global directory is created lazily on first write (`mkdir -p`); no
  provisioning step.
- A shadcn segmented/toggle primitive may need installation via the project's
  `bunx --bun shadcn@latest add` flow (per CLAUDE.md) if none exists.

## Monitoring and Observability

No new operational surface. Errors flow through the existing `mapError`/API error
codes (`WORKFLOW_INVALID`, `WORKFLOW_EXISTS`, `WORKFLOW_RUN_ACTIVE`,
`NOT_FOUND`, `MISSING_CWD`). Daemon logging is unchanged. The global directory's
location is derivable from `XDG_STATE_HOME` for support/debugging.

## Technical Considerations

### Key Decisions

- **Decision:** Store global workflows under the daemon's existing state root
  (ADR-002). **Rationale:** one user-level storage root, `XDG_STATE_HOME`-
  overridable for tests. **Trade-off:** mixes authored content with run state.
  **Rejected:** XDG config dir, plain dotfolder.
- **Decision:** Thread `scope` through the existing routes; merge the list
  server-side (ADR-003). **Rationale:** one combined response, back-compatible,
  reuses all file helpers and guards. **Trade-off:** list reads two dirs; a new
  field threads through every consumer. **Rejected:** parallel
  `/global-workflows` tree; client-side merge.
- **Decision:** Scope is derived from file location, not persisted in the JSON.
  **Rationale:** keeps the workflow document portable and avoids a redundant
  source of truth. **Trade-off:** moving scopes means moving files (out of scope
  for MVP — edits preserve scope).

### Known Risks

- **Default-scope ambiguity** (low likelihood): a CRUD caller omitting `scope`
  targets project scope. *Mitigation:* document the default; the web client
  always sends explicit scope.
- **Cross-scope name collision** (medium likelihood): same name in both scopes.
  *Mitigation:* per-scope 409 only; scope badge and `scope+name` keys in the UI.
- **State-dir wipe** (low likelihood): clearing `~/.local/state` deletes global
  workflows. *Mitigation:* documentation; acceptable for MVP.

## Architecture Decision Records

- [ADR-001: Merged scope model for global and project workflows](adrs/adr-001.md)
  — Scope is a first-class, visible property; one global home, one combined
  badged list, active-cwd run semantics (from the PRD).
- [ADR-002: Store global workflows in the XDG state directory](adrs/adr-002.md)
  — Global files live under `(XDG_STATE_HOME ?? ~/.local/state)/workflow-runner/workflows/`,
  reusing the daemon storage root.
- [ADR-003: Thread scope through the existing workflow routes](adrs/adr-003.md)
  — Extend list + CRUD with a `scope` discriminator and merge the list
  server-side, rather than adding a parallel route tree.
