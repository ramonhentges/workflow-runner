# Start Workflow from Step Specification

## Problem Statement

Workflow runs always enter the first configured step even though the domain runner already accepts an arbitrary entry step. Operators need to skip already completed or irrelevant work and launch a new run at an exact workflow step from both the web start form and the terminal launch command that attaches to the TUI.

## Goals

- [ ] A valid step ID can be selected as the first executed step from the web UI and terminal launch command.
- [ ] The selected entry step is validated before any run or worktree state is created.
- [ ] Omitting the option preserves the current first-step behavior on every surface.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Resuming an existing run at an arbitrary step | This feature creates a new run; retry/resume semantics remain unchanged. |
| Synthesizing handoff context for skipped steps | A new entry step has no previous-step output. |
| Automatically executing dependencies or predecessor steps | Starting from a step intentionally skips all predecessors. |
| Changing workflow graph definitions or step ordering | The feature only chooses an existing step as the entry point. |
| A separate interactive terminal workflow picker | The current terminal launch surface is `workflow-runner start`, which then attaches to the TUI. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Terminal/TUI interaction | Add `--step <step-id>` and `--step=<step-id>` to `workflow-runner start`; normal attached TUI behavior follows launch. | This matches the existing terminal architecture and existing `--branch`/`--prompt` flag conventions. | Yes — 2026-07-01 |
| Step identity | Match the configured step ID exactly and case-sensitively. | Step IDs are existing domain identifiers and are currently exact map keys. | Yes — 2026-07-01 |
| Omitted entry step | Use `workflow.firstStepId()` exactly as today. | Backward compatibility for CLI, RPC, HTTP, and web callers. | Yes — 2026-07-01 |
| Web control for a listed workflow | Show an optional selector populated from the selected workflow document, in workflow order. | Prevents typing errors and preserves the author-defined ordering. | Yes — 2026-07-01 |
| Web control for a manual workflow path | Show an optional free-text step-ID input because the existing browser API cannot inspect arbitrary filesystem paths. | Preserves manual-path launch without adding an unsafe arbitrary-file read API. | Yes — 2026-07-01 |
| Initial prompt semantics | Deliver the prompt to the selected entry step as a `user-request`. | The selected step is the first step of a fresh run, not a handoff target. | Yes — 2026-07-01 |
| Invalid step handling | Reject the start request as `WORKFLOW_INVALID`, name the missing step, and create no run/worktree/event state. | Invalid configuration must fail before resource reservation or mutation. | Yes — 2026-07-01 |

**Open questions:** none — all unresolved choices are logged as explicit defaults above.

---

## User Stories

### P1: Start a New Run at an Exact Step ⭐ MVP

**User Story**: As a workflow operator, I want to choose an existing step as a new run's entry point so that I can skip predecessor work that should not be repeated.

**Why P1**: This is the core execution capability required by both user surfaces.

**Acceptance Criteria**:

1. **SFS-01** — WHEN a start request omits `startStepId` THEN the system SHALL enter the workflow's first configured step exactly as before.
2. **SFS-02** — WHEN a start request supplies an exact existing `startStepId` THEN the system SHALL make that step the first banner, first current step, and first visited step, without executing or marking any predecessor as visited.
3. **SFS-03** — WHEN an initial prompt accompanies a valid `startStepId` THEN the system SHALL deliver it to the selected entry step with inbound kind `user-request`.
4. **SFS-04** — WHEN `startStepId` is empty at a typed boundary or does not exactly match a workflow step THEN the system SHALL reject the request as `WORKFLOW_INVALID`, include the requested ID in the error when available, and create no run snapshot, worktree, event log, or active-run slot.

**Independent Test**: Start a three-step workflow at its second step and verify that the first emitted banner/current-step/visited-step is the second step, then repeat without the option and verify that the first step remains the entry point.

---

### P1: Choose the Entry Step in the Web UI ⭐ MVP

**User Story**: As a web UI operator, I want to choose a start step while configuring a run so that the run begins at the intended point without requiring the terminal.

**Why P1**: The web UI is a required launch surface.

**Acceptance Criteria**:

1. **SFS-05** — WHEN a listed workflow is selected THEN the web form SHALL load its workflow document and offer `Default (first step)` plus every configured step ID in workflow order.
2. **SFS-06** — WHEN the operator selects a non-default step and submits a valid form THEN the web client SHALL send that exact ID as `startStepId` and navigate to the created run as it does today.
3. **SFS-07** — WHEN the operator changes the selected workflow THEN the web form SHALL reset the entry-step choice to `Default (first step)` so a step from the previous workflow cannot be submitted.
4. **SFS-08** — WHEN the operator uses a manual workflow path THEN the web form SHALL accept an optional exact step ID as text and omit `startStepId` when that field is blank.
5. **SFS-09** — WHEN the server rejects the requested step THEN the web form SHALL retain the submitted values and display the server error without navigating.

**Independent Test**: Select a listed workflow, choose its second step, submit, and assert the POST body and navigation; repeat with a manual path and typed step ID.

---

### P1: Choose the Entry Step from the Terminal/TUI Launch ⭐ MVP

**User Story**: As a terminal operator, I want to pass a step ID to the start command so that the newly created run begins there before the command attaches to the TUI.

**Why P1**: The terminal/TUI launch surface is explicitly required.

**Acceptance Criteria**:

1. **SFS-10** — WHEN `workflow-runner start <workflow> --step <id>` or `--step=<id>` is invoked THEN the CLI SHALL send the exact ID as `startStepId` in the daemon RPC request.
2. **SFS-11** — WHEN `--step` has no value or an empty equals value THEN argument parsing SHALL fail before connecting to the daemon and SHALL print usage containing the supported syntax.
3. **SFS-12** — WHEN a valid `--step` run starts in an interactive terminal THEN the command SHALL attach to that run using the existing TUI flow; detached and non-TTY behavior SHALL remain unchanged.
4. **SFS-13** — WHEN the daemon rejects an unknown step THEN the command SHALL print a workflow-invalid error, close the client, return exit code 1, and not attach.

**Independent Test**: Parse and launch with both flag forms, assert the exact RPC payload, and verify attach/detach behavior remains unchanged.

---

## Edge Cases and Implicit-Requirement Dimensions

| Dimension | Resolution |
| --------- | ---------- |
| Input validation & bounds | Optional exact, case-sensitive, non-empty step ID; typed HTTP and CLI boundaries reject empty values, while the run manager rejects any non-matching ID after loading the workflow. |
| Failure / partial-failure states | Unknown steps fail before run ID allocation, registry reservation, persistence, event-log/MCP creation, or worktree mutation. The web form retains input and the terminal reports the mapped workflow error. |
| Idempotency / retry / duplicate handling | N/A because start requests intentionally create distinct runs; the optional entry step does not change existing start idempotency. |
| Auth boundaries & rate limits | N/A because the feature adds no new endpoint or authorization boundary; existing daemon/API access and run limits apply. |
| Concurrency / ordering | Validation occurs before synchronous active-slot reservation; existing run-limit and unique-ID behavior remains authoritative. Workflow step order controls web selector order only. |
| Data lifecycle / expiry | N/A because the selected step is reflected by existing current/visited state and event logs; no new persistent entity or retention rule is added. |
| Observability | The existing first boundary snapshot, banner, status, and event log identify the selected entry step. No skipped predecessor events are emitted. |
| External-dependency failure | N/A because step selection adds no external dependency; existing workflow-file, git, MCP, and agent-session failures retain their behavior. |
| State-transition integrity | Only a step present in the loaded workflow can become the initial current step. A fresh run starts with no visited steps and marks the selected entry only through the existing boundary transition. |

Additional edge behavior:

- WHEN the selected entry step is the configured first step THEN behavior SHALL be equivalent to omitting the option.
- WHEN the selected entry step is terminal or otherwise has no outgoing edges THEN normal step outcome behavior SHALL apply without special handling.
- WHEN a workflow contains branches or cycles THEN any existing step SHALL be a valid entry regardless of graph reachability from the configured first step.
- WHEN a listed workflow document cannot be loaded in the web UI THEN the form SHALL keep the default entry choice, communicate that steps could not be loaded, and still permit the existing manual-path flow.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| SFS-01 | Start at exact step | Design | Pending |
| SFS-02 | Start at exact step | Design | Pending |
| SFS-03 | Start at exact step | Design | Pending |
| SFS-04 | Start at exact step | Design | Pending |
| SFS-05 | Web UI | Design | Pending |
| SFS-06 | Web UI | Design | Pending |
| SFS-07 | Web UI | Design | Pending |
| SFS-08 | Web UI | Design | Pending |
| SFS-09 | Web UI | Design | Pending |
| SFS-10 | Terminal/TUI | Design | Pending |
| SFS-11 | Terminal/TUI | Design | Pending |
| SFS-12 | Terminal/TUI | Design | Pending |
| SFS-13 | Terminal/TUI | Design | Pending |

**Coverage:** 13 total, 0 mapped to tasks, 13 pending design.

---

## Success Criteria

- [ ] The same optional `startStepId` contract reaches the runner through HTTP and daemon RPC paths.
- [ ] Web and terminal users can launch at a valid non-first step without executing predecessors.
- [ ] Invalid entry steps leave no run-side state or git worktree mutation.
- [ ] Existing start behavior and tests remain unchanged when no entry step is supplied.
