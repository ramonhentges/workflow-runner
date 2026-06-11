# PRD: Manage global workflows from the web

## Overview

Today every workflow in workflow-runner is project-scoped: it lives under a
specific project's `workflows/` folder and is only visible when that project's
working directory is active. To reuse a workflow across several projects, a user
must copy its JSON into each project, which causes drift and duplication.

This feature introduces **global workflows** — a single, canonical, user-level
collection of workflows that can be run, created, edited, deleted, and listed
from the web UI **alongside** a project's own workflows. A global workflow runs
against whatever project the user currently has active, so one definition serves
every project without copying.

- **What problem it solves:** eliminates copy-paste reuse of workflows across
  projects and the drift that follows.
- **Who it is for:** workflow-runner users who maintain a set of reusable
  workflows and apply them to multiple projects.
- **Why it is valuable:** one definition, maintained in one place, usable
  everywhere — less duplication, less drift, faster setup of new projects.

## Goals

- Let a user run a single global workflow against any active project without
  copying its JSON into that project.
- Present global and project workflows together in one list, with each item's
  scope clearly marked.
- Support the full lifecycle for global workflows from the web UI — create, edit,
  delete, list, and run — with the same ease as project workflows.
- Ship the complete capability in a single phase (the scope of the change is
  bounded and the features are interdependent).

Success indicators:
- A user can take a workflow they previously copied into N projects and maintain
  it once as a global workflow.
- The combined list correctly distinguishes global from project workflows at a
  glance, with zero mislabeling.

## User Stories

**Primary persona — the multi-project user** (maintains reusable workflows and
applies them across projects):

- As a multi-project user, I want to save a workflow once as global so that I can
  run it in any project without copying its JSON.
- As a multi-project user, I want to see my global workflows in the same list as
  the current project's workflows, marked as global, so that I know what I can
  run here.
- As a multi-project user, I want to run a global workflow and have it operate on
  my currently active project so that the same definition works everywhere.
- As a multi-project user, I want to edit a global workflow once so that the
  change applies the next time I run it in any project.
- As a multi-project user, I want to delete a global workflow I no longer need so
  that my list stays relevant.
- As a multi-project user, I want to create a new global workflow from the web UI
  so that reusable workflows have a home from the start.

**Edge cases:**

- As a user, when a global and a project workflow share the same name, I want
  both shown and distinguished by their scope badge so that I can tell them
  apart and act on the right one.
- As a user, when no working directory is active, I expect the workflows area to
  stay gated (unchanged behavior), and I understand global workflows appear once
  I select a working directory.
- As a user, when a global workflow has an active run, I expect the same
  protection that prevents deleting or renaming it mid-run as project workflows
  have.

## Core Features

**1. Global workflow scope (foundational).**
Every workflow has a scope: `global` or `project`. Global workflows belong to a
single user-level collection independent of any project; project workflows
continue to belong to their project. Scope is a visible property, not an inferred
one.

**2. Combined, badged workflow list.**
The web workflow list shows both the active project's workflows and all global
workflows together. Each row carries a badge marking it **Global** or
**Project**. Both scopes appear whenever the workflows area is visible.

**3. Global workflow lifecycle (create / edit / delete).**
Users can create a new global workflow, edit an existing one, and delete one from
the web UI, using the same editor and flows as project workflows. Saving a global
workflow edit takes effect with no extra confirmation step. Deleting and renaming
respect the existing active-run protection.

**4. Run a global workflow against the active project.**
Starting a run from a global workflow uses the currently active working directory
as the run's project context — identical run semantics to a project workflow.
The same definition therefore produces project-appropriate results wherever it
runs.

Feature interaction: scope (1) is the property the list (2), lifecycle (3), and
run targeting (4) all key off. The list distinguishes what the lifecycle and run
actions operate on; run targeting reuses the existing active-cwd run path.

## User Experience

**Key persona & goal:** the multi-project user wants reusable workflows to be
maintained once and runnable everywhere, while still clearly separating "mine
everywhere" from "this project's."

**Primary flows:**

1. *See available workflows.* The user selects a working directory. The workflow
   list loads and shows the project's workflows and all global workflows in one
   list, each badged with its scope.

2. *Run a global workflow.* From the start-run experience, the user picks a
   global workflow (badged Global) and starts it. The run executes against the
   active working directory, like any project run, and the user is taken to the
   run view.

3. *Create a global workflow.* The user creates a new workflow and designates it
   global. It is saved to the user-level collection and immediately appears,
   badged Global, in every project's combined list.

4. *Edit a global workflow.* The user opens a global workflow in the editor,
   makes changes, and saves. The change applies with no extra friction and takes
   effect on the next run in any project.

5. *Delete a global workflow.* The user deletes a global workflow. If a run of it
   is active, the action is blocked with the same protection project workflows
   have; otherwise it is removed from every project's combined list.

**UI/UX considerations:**

- The scope badge must be legible at a glance and consistently placed across the
  list, editor, and start-run surfaces.
- When a global and project workflow share a name, both remain visible and
  distinguishable solely by badge — no silent hiding or merging.
- The workflows area remains gated behind an active working directory; nothing
  about global workflows changes that gate.

**Discoverability:** global workflows surface automatically in the combined list
once a working directory is active; no separate navigation or mode switch is
required to find them.

## Non-Goals (Out of Scope)

- **Precedence / shadowing.** A project workflow does not override a same-named
  global one; both are shown side by side. No layered-overlay behavior.
- **Per-run target selection.** Global runs always use the active working
  directory; there is no per-run directory picker.
- **Edit-impact friction.** No "this affects all projects" confirmation gate on
  saving or deleting global workflows.
- **Visibility without an active working directory.** The workflows area stays
  gated behind an active cwd; global workflows are not shown when none is
  selected.
- **Sharing, teams, permissions, or org-level catalogs.** Global is user-level
  only; no roles, sharing, or access control.
- **CLI management of global workflows.** Authoring lifecycle stays web-only,
  consistent with the existing project-workflow authoring model.
- **Migration tooling.** No automatic detection or promotion of duplicated
  project workflows into global ones.

## Phased Rollout Plan

The change is bounded and its features are interdependent (the list, lifecycle,
and run targeting are not useful without the scope concept), so it ships as a
single phase rather than an incremental ramp.

### MVP (Phase 1) — the whole feature

- Global scope as a first-class, visible property of a workflow.
- Combined, badged list of project + global workflows.
- Create, edit, and delete global workflows from the web UI, with active-run
  protection on delete/rename.
- Run a global workflow against the active working directory.

Success criteria (feature complete): a user can create a global workflow once,
see it badged in every project's combined list, run it against any active
project, edit it once for all projects, and delete it — with no JSON copying at
any point.

### Phase 2 — not planned

No second phase is currently scoped. Candidate future work (explicitly deferred):
edit-impact warnings, promotion of duplicated project workflows to global, and
visibility of global workflows without an active working directory.

### Phase 3 — not planned

Reserved for any future sharing/teams direction, which is out of scope today.

## Success Metrics

- **Reuse achieved:** users maintain previously-duplicated workflows as a single
  global definition (qualitative confirmation that copy-paste reuse is no longer
  needed).
- **Scope clarity:** zero reports of users acting on the wrong workflow due to
  global/project confusion; badges are unambiguous in the combined list.
- **Lifecycle parity:** create/edit/delete/run of a global workflow succeed from
  the web UI as reliably as the equivalent project-workflow operations.
- **Safety preserved:** no global workflow can be deleted or renamed while a run
  of it is active.

## Risks and Mitigations

- **Scope confusion (adoption risk).** Users may not notice whether a workflow is
  global or project. *Mitigation:* a consistent, legible scope badge everywhere a
  workflow appears.
- **Unintended cross-project edits (adoption risk).** A frictionless edit to a
  global workflow changes behavior in every project. *Mitigation accepted as a
  trade-off* for this MVP (frictionless edit was chosen deliberately); the badge
  is the cue. An edit-impact warning remains a deferred candidate if confusion
  arises.
- **Name collisions.** A global and project workflow may share a name.
  *Mitigation:* both are always shown and distinguished by badge; neither hides
  the other.
- **Discoverability tied to the cwd gate.** Because the workflows area is gated
  behind an active directory, a user with no directory selected won't see global
  workflows. *Mitigation:* this matches existing behavior and user expectation;
  revisiting the gate is a deferred candidate.

## Architecture Decision Records

- [ADR-001: Merged scope model for global and project workflows](adrs/adr-001.md)
  — Scope becomes a first-class, visible property; global workflows live in one
  user-level home, appear in a combined badged list, and run against the active
  working directory.

## Open Questions

- **Name-collision affordance:** beyond the badge, do users need any additional
  cue (e.g., grouping or ordering) when a global and project workflow share a
  name? Default for MVP: badge only.
- **Run-history labeling:** should a completed run record which scope its
  workflow came from, for later clarity? Not required for MVP; flag for
  consideration.
