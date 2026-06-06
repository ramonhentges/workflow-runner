---
status: completed
title: Documentation update (README and CLAUDE.md)
type: docs
dependencies:
  - task_03
  - task_05
  - task_09
complexity: low
---

# Task 10: Documentation update (README and CLAUDE.md)

## Overview
Document the new web + API workflow management capability so users and future
contributors know it exists, that it is web/API-only (no CLI), and how the new
endpoints and pages behave. Keeps the repository's canonical docs in sync with
the shipped feature.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST update `README.md` to describe workflow management in the web app: list/create/edit/delete within a project, per-IDE agent/model discovery with manual override, and run-aware delete.
- MUST update `CLAUDE.md` to list the new API endpoints (workflow read-one/create/update/delete and `GET /ide/{ide}/catalog`) and note that workflow authoring is web/API-only (no CLI command).
- MUST state that saved workflows are server-validated and that filenames are addressed by bare name (`.json` appended).
- MUST keep documentation consistent with the existing tone and structure, and accurate to the shipped routes/pages.
- SHOULD cross-reference the supported `ide` values and that discovery requires the IDE installed/authenticated locally.
</requirements>

## Subtasks
- [x] 10.1 Add a workflow-management section to `README.md` (web flows + discovery + delete behavior).
- [x] 10.2 Add the new endpoints and the web/API-only note to `CLAUDE.md`.
- [x] 10.3 Document bare-name addressing and server-side validation.
- [x] 10.4 Verify all documented endpoints/pages match the implemented behavior.

## Implementation Details
Edit `README.md` and `CLAUDE.md` at the repository root. Align with the
"Workflow JSON format" and architecture sections already present in `CLAUDE.md`.
Reference the PRD/TechSpec for accuracy; do not duplicate ADR content verbatim.
Since this is a docs task, "tests" are verification checks that the docs match the
code (links resolve, endpoints exist, values are correct).

### Relevant Files
- `README.md` — user-facing docs and E2E section.
- `CLAUDE.md` — commands, architecture, workflow JSON format, API surface.
- `src/app/api/app.ts` — authoritative list of registered routes to document.
- `_techspec.md` — endpoint table and behavior to summarize.

### Dependent Files
- None (documentation only).

### Related ADRs
- [ADR-004: Filename-addressed REST workflow CRUD](../adrs/adr-004.md) — bare-name addressing + validation to document.
- [ADR-002: Live per-IDE discovery with manual override](../adrs/adr-002.md) — discovery behavior to document.
- [ADR-003: Run-aware deletion](../adrs/adr-003.md) — delete behavior to document.

## Deliverables
- Updated `README.md` and `CLAUDE.md` reflecting the feature.
- Verification that documented endpoints/pages match the implementation **(REQUIRED)**.
- Doc-accuracy checks recorded as the task's test checklist **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Every endpoint documented in `CLAUDE.md` is registered in `src/app/api/app.ts` (manual cross-check).
  - [x] Supported `ide` values in the docs match `PROFILES` in `ide-profiles.ts`.
  - [x] README delete behavior matches ADR-003 (block while running, plain confirm).
- Integration tests:
  - [x] Markdown links to ADRs and sections resolve (no broken references).
- Test coverage target: >=80% (documentation accuracy checks)
- All tests must pass

## Success Criteria
- All tests passing
- Documentation accurately describes the shipped endpoints and web pages
- Web/API-only constraint and bare-name addressing are clearly stated
- No broken links or stale endpoint references
