---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/app/api/schema.ts
line: 36
severity: medium
author: claude-code
provider_ref:
---

# Issue 006: `cwd` is write-only — expose it on run detail/list and add a `cwd` list filter

## Review Comment

`cwd` is a required start parameter (ADR-002: the UI launches runs "across
multiple projects" by choosing a project directory), but it is currently
**write-only**: a caller can set it on `POST /runs` and can never read it back.

Confirmed current state:

- `cwd` is accepted by `RunManager.startRun(workflowPath, cwd)` and passed only
  into `new Runner(workflow, ..., { cwd, ... })`
  (`src/infra/daemon/run-manager.ts:167-168`). It is **not** stored on the `Run`
  aggregate or in `RunSnapshot` (`src/domain/run.ts:16-27`, `Run.create` at
  `:62-78` takes only `id`/`slug`/`workflowPath`), and **not** persisted by the
  run store. So it is lost the moment `startRun` returns.
- Neither `RunSummary` nor `RunDetail` (`src/app/api/schema.ts:23-47`) carries a
  `cwd` field, so `GET /runs` and `GET /runs/:id` cannot return it.
- `GET /runs` only accepts `?all` (`src/app/api/routes/runs.ts:10-13`); there is
  no way to filter the list by working directory.

This is a contract gap for the primary consumer: a dashboard rendering runs from
several projects has no way to display which project a run belongs to, nor to
scope its run list to one project. The directory is the very dimension ADR-002
made first-class, yet it is invisible after launch.

Requested change (three parts):

1. **Persist `cwd`.** Add `cwd` to the `Run` aggregate and `RunSnapshot`
   (`src/domain/run.ts`), thread it through `Run.create` in
   `RunManager.startRun`, and persist/restore it via the run store and
   `discoverOnStartup` (so it survives a daemon restart). This is the
   prerequisite for the rest.
2. **Return `cwd` on detail and list.** Add `cwd` to `RunDetailSchema` and
   `RunSummarySchema` (`src/app/api/schema.ts`) and populate it in
   `routes/run-detail.ts`, `routes/runs.ts`, and the WS attach `snapshot` frame
   (`routes/ws-attach.ts`) so the snapshot stays consistent with `GET /runs/:id`.
   Keep the JSON-RPC `RunListEntry`/`RunSnapshot` shapes in sync so the two
   transports do not drift (a stated success criterion).
3. **Add a `cwd` filter to `GET /runs`.** Accept an optional `?cwd=<path>` query
   param (extend the query schema in `routes/runs.ts`) and return only runs whose
   `cwd` matches, so a dashboard can scope the list to a single project.

Update `docs/ws-protocol.md` (the `RunDetail`/snapshot description) and the
OpenAPI completeness test accordingly, and add tests covering the new field on
detail/list, the filter, and round-trip persistence across restart.

## Triage

- Decision: `valid`
- Notes: Confirmed all three gaps exist. `Run.create()` takes only `{id, slug, workflowPath}` — no `cwd` param. `RunSnapshot` has no `cwd` field. `RunSummarySchema`/`RunDetailSchema` in `schema.ts` have no `cwd`. `routes/runs.ts` query schema only has `all`. Fix plan: (1) add optional `cwd?: string` to `RunSnapshot` and `Run.create()`, storing it on the `Run` aggregate; (2) thread `cwd` into `Run.create()` in `RunManager.startRun()` and preserve it in `retryStep()` snapshot reconstruction; (3) update `RunSummarySchema`/`RunDetailSchema` and all three route handlers (`runs.ts`, `run-detail.ts`, `ws-attach.ts`); (4) add `?cwd=` filter to `GET /runs`; (5) add `cwd` to `RunListEntry` in `protocol.ts` for JSON-RPC parity. Making `cwd` optional (`?`) in `RunSnapshot` preserves backward compat with on-disk snapshots from before this change — no migration needed in `run-store.ts`.
