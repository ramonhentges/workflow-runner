# PRD: Workflow Management (Create, Edit, Delete)

## Overview

Today a workflow can only be authored by hand-editing JSON files under a
project's `workflows/` directory; the app can list and run them but offers no
way to create, change, or remove them. This feature adds **workflow management
to the web app and API** — new pages to create, edit, and delete the workflows
inside a project, backed by API endpoints. It is deliberately **web + API only;
the CLI is not extended.**

A "project" is an already-registered working directory (the entries in the
existing sidebar project switcher). This feature does not change how projects
are managed; it operates on the workflows *inside* a selected project.

Authoring is **form-based**: an ordered list of steps, each step a small set of
fields (id, ide, agent, model, mode, description) plus its handoff edges to
other steps. Because a step's valid `agent` and `model` depend on its `ide`, the
editor offers **per-IDE discovery** — it asks the selected IDE what agents and
models it actually supports and suggests them — while always letting the user
**type a value manually**.

It is for the person operating Workflow Runner who designs multi-agent,
multi-IDE handoff workflows and wants to build and maintain them without leaving
the app or hand-writing JSON.

## Goals

- Let a user create, edit, and delete workflows within a selected project
  entirely from the web app, with no manual file editing and no CLI step.
- Make authoring safe: surface validation problems before a workflow is saved,
  so saved workflows are well-formed.
- Make step configuration discoverable: suggest the agents and models the chosen
  IDE actually supports, while allowing manual entry as an escape hatch.
- Protect in-progress work: never let a delete (or identity-changing edit) break
  a run that is currently executing.
- Ship the smallest authoring experience that fully replaces hand-editing for
  the common case, and keep a clear path to a later visual canvas.

## User Stories

Primary persona — **Workflow Author** (the person operating Workflow Runner):

- As an author, I want to see all workflows in my selected project so that I can
  choose one to edit or decide to create a new one.
- As an author, I want to create a new workflow from scratch so that I can design
  a new multi-step process.
- As an author, I want to create a new workflow by duplicating an existing one so
  that I can start from a working baseline instead of a blank page.
- As an author, I want to add, remove, and reorder steps in a form so that I can
  shape the flow without writing JSON.
- As an author, I want each step's agent and model choices suggested based on the
  IDE I picked so that I don't have to remember or look up valid ids.
- As an author, I want to type an agent or model id by hand when the suggestion
  list is unavailable or doesn't include what I need so that I'm never blocked.
- As an author, I want to define handoff edges between steps (with an intent) so
  that interactive steps can hand off correctly.
- As an author, I want to be told about problems (duplicate ids, an edge pointing
  nowhere, a missing required field) before I save so that I don't create a
  broken workflow.
- As an author, I want to rename and edit an existing workflow so that I can
  evolve it over time.
- As an author, I want to delete a workflow I no longer need so that my project
  list stays clean.
- As an author, I want to be stopped from deleting a workflow that has a run in
  progress so that I don't disrupt active work.

## Core Features

### 1. Workflow list (per project) — must have

Within the selected project, show every workflow with enough identity to pick
one (name and file). Entry points to create a new workflow, and per-workflow
actions to edit or delete. This is the home of the feature and the launch point
for every other action.

### 2. Create workflow — must have

Two ways to start:
- **Blank**: a new workflow with sensible empty defaults, ready to add steps.
- **Duplicate existing**: pre-fill from another workflow in the project so the
  author edits rather than starts cold.

A new workflow is saved into the selected project's workflow collection and
becomes immediately listable and runnable.

### 3. Form-based step editor — must have

An ordered list of steps. For each step the author edits: id, ide, agent, model,
mode (interactive/autonomous), description, and the step's handoff edges
(each edge = a target step + an intent). The author can add, remove, and reorder
steps. The editor reflects the workflow's identity fields (name, etc.) as well.
See [ADR-001](adrs/adr-001.md).

### 4. Per-IDE agent/model discovery with manual override — must have

When a step's IDE is chosen, the editor offers the agents and models that IDE
actually supports, retrieved on demand from the IDE. If the IDE can't be reached
or the author prefers, they can type any agent/model id directly. Discovery is
best-effort and never blocks editing or saving. See [ADR-002](adrs/adr-002.md).

### 5. Validate before save — must have

Before a workflow is saved, the editor checks it for well-formedness (e.g.
required fields present, unique step ids, edges referencing real steps, valid
mode) and surfaces any problems so the author can fix them. Saved workflows are
well-formed.

### 6. Edit workflow — must have

Open an existing workflow in the same editor, change anything (including its
name/identity), and save. Identity-changing edits are subject to the same active-
run guard as delete.

### 7. Delete workflow (run-aware) — must have

Delete a workflow from the project. If a run of that workflow is currently in
progress, the delete is refused with a clear message to stop the run first.
Otherwise a standard confirmation is shown and the workflow is removed; no
extra "past runs reference this" warning is shown. See [ADR-003](adrs/adr-003.md).

## User Experience

**Personas and goals.** The Workflow Author wants to go from "I need a new
multi-agent flow" to "a saved, runnable workflow" quickly, and to maintain those
workflows over time, all inside the web app for the currently selected project.

**Primary flow — create:**
1. Author selects a project in the existing sidebar switcher.
2. Opens the workflow list and chooses "New workflow" (blank or duplicate).
3. Adds steps; for each step picks an IDE, then picks an agent and model from the
   suggested list or types them in; sets mode and description.
4. Connects steps with handoff edges and intents.
5. The editor flags any problems; the author resolves them.
6. Saves. The workflow appears in the list and can be started like any other.

**Primary flow — edit:** open from the list, change fields/steps/edges, save
(blocked only if a run is currently active and the change alters identity).

**Primary flow — delete:** from the list, choose delete; blocked with guidance
if a run is active, otherwise confirm and remove.

**UX considerations:**
- New pages mount under the existing app shell and navigation; the workflow list
  is reachable per selected project alongside Dashboard and Start Run.
- The agent/model pickers clearly indicate when suggestions are being fetched,
  when they came from the IDE, and that manual entry is always allowed.
- Validation feedback is inline and specific (which step, which field, what's
  wrong), shown before save rather than as an opaque failure.
- Destructive actions (delete, identity-changing edit during a run) are guarded
  and clearly explained.

## High-Level Technical Constraints

- **Web + API only.** No CLI command is added for workflow authoring; every
  capability is exposed through the API and consumed by the web app.
- **Operates within the existing project model.** Workflows belong to a selected
  project (registered working directory); this feature does not redefine or
  manage projects themselves.
- **Authoritative agent/model source is the IDE.** Suggestions reflect what the
  selected IDE reports; the system cannot guarantee a complete catalog and must
  degrade gracefully to manual entry.
- **Saved workflows must be well-formed** so they remain runnable by the existing
  runner without changes to run/execution behavior.
- **Discovery is best-effort and must never block authoring or saving.**

## Non-Goals (Out of Scope)

- **Visual graph canvas authoring** — deferred to a later phase
  ([ADR-001](adrs/adr-001.md)); this feature ships the form editor.
- **Project management** — creating, renaming, or removing projects; the project
  switcher stays as-is.
- **CLI workflow authoring** — explicitly excluded.
- **Caching or a curated catalog of agents/models** — discovery is a live,
  best-effort probe with manual override ([ADR-002](adrs/adr-002.md)); no cache
  layer this phase.
- **Changing how workflows run** — execution, runs, retry, and the runner are
  unchanged; this feature only authors the definitions they consume.
- **Workflow versioning / history / templates gallery** beyond "duplicate an
  existing workflow."
- **Multi-user collaboration, sharing, or permissions** on workflows.
- **A "past runs reference this workflow" delete warning** — intentionally
  omitted ([ADR-003](adrs/adr-003.md)).

## Phased Rollout Plan

### MVP (Phase 1)

- Workflow list per project.
- Create (blank + duplicate), edit, delete (run-aware) via web + API.
- Form-based step editor with add/remove/reorder, edges, and validate-before-save.
- Per-IDE live agent/model discovery with manual override.

**Success criteria to proceed:** an author can create, edit, and delete a
working multi-step, multi-IDE workflow end-to-end from the web app, and the
resulting workflow runs successfully — without hand-editing any file or using
the CLI.

### Phase 2

- **Visual graph canvas** as a topology view over the same data, reusing the
  step (node) configuration form ([ADR-001](adrs/adr-001.md)).
- Quality-of-life: clearer branching visualization, drag-to-connect edges.

**Success criteria to proceed:** authors can view and adjust handoff topology
visually without losing any form-based capability.

### Phase 3

- Optional refinements driven by usage: e.g. discovery caching/refresh if probe
  latency proves painful, duplicate-as-template improvements.

**Long-term success:** workflow authoring is fully self-service in the app and
hand-editing JSON is effectively retired.

## Success Metrics

- **Self-service authoring:** new and edited workflows are created through the
  app rather than by hand-editing files (target: hand-editing no longer needed
  for the common case).
- **First-run validity:** a high share of workflows saved through the editor run
  without an authoring-caused failure on first start (validation catches
  problems before save).
- **Discovery usefulness:** agent/model values are most often chosen from
  suggestions rather than typed, where the IDE is reachable — with manual entry
  available and used when it isn't.
- **Safety:** zero active runs disrupted by a workflow delete or identity-
  changing edit.
- **Task completion:** an author can go from "new workflow" to "first successful
  run" in a single uninterrupted session.

## Risks and Mitigations

- **Discovery friction (IDE unreachable/slow).** If probing the IDE is slow or
  fails, the picker could frustrate authors. *Mitigation:* best-effort discovery
  with an always-available manual-entry fallback and clear status; saving never
  waits on discovery.
- **Accidental deletion of a still-useful workflow.** Run-aware delete protects
  active runs but not future intent. *Mitigation:* standard confirmation step;
  duplicate-existing and recreation remain easy.
- **Scope creep toward the canvas.** Pressure to build the visual editor now
  could delay the MVP. *Mitigation:* canvas is explicitly Phase 2 and reuses the
  form; MVP ships the form first.
- **Authoring/runtime divergence.** A workflow that passes editor validation but
  still fails at run (e.g. an agent/model the IDE rejects at runtime).
  *Mitigation:* the existing fail-at-the-step behavior preserves earlier work;
  validation focuses on structural well-formedness, and discovery reduces bad
  agent/model entries.
- **Adoption.** Authors comfortable with hand-editing might bypass the UI.
  *Mitigation:* make the editor at least as fast as hand-editing (duplicate,
  reorder, inline validation, discovery).

## Architecture Decision Records

- [ADR-001: Form-based workflow authoring now, visual canvas deferred](adrs/adr-001.md) — Ship the form-based step editor; defer the visual graph canvas to a later phase that reuses the node-config form.
- [ADR-002: Live per-IDE discovery of agents and models, with manual override](adrs/adr-002.md) — Probe the selected IDE on demand for its agents/models; always allow manual entry; no caching this phase.
- [ADR-003: Run-aware deletion — block while running, plain confirm otherwise](adrs/adr-003.md) — Refuse deletes/identity edits while a run is active; otherwise a standard confirm with no history warning.

## Open Questions

- **Workflow identity vs. file name:** the list shows a file name and a workflow
  name; should renaming a workflow rename its underlying file, and how should id
  collisions within a project be presented? (Resolve during TechSpec / UX.)
- **Discovery scope:** should discovery surface agents and models together in one
  probe per IDE, or allow refreshing one without the other? (Best-effort either
  way; refine in TechSpec.)
- **Reorder semantics:** does step order carry meaning beyond "first step is the
  entry point," and should the editor enforce a single clear entry step?
- **Active-run detection granularity:** is "a run in progress for this workflow"
  scoped to the selected project only, or across all projects?
