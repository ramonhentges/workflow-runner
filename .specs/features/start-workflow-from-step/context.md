# Start Workflow from Step Context

**Gathered:** 2026-07-01
**Spec:** `.specs/features/start-workflow-from-step/spec.md`
**Status:** Confirmed by user; ready for implementation

---

## Feature Boundary

Create a new workflow run whose first executed step is an operator-selected existing step, exposed through the web start form and the terminal `start` command that attaches to the TUI. Existing-run resume/retry and workflow graph editing are unchanged.

---

## Implementation Decisions

### Entry Semantics

- `startStepId` is optional at HTTP and RPC boundaries.
- Omission uses the first configured workflow step.
- A supplied ID is matched exactly and validated against the loaded workflow before state or resources are created.
- Skipped predecessors produce no visited entries, boundaries, banners, or handoff context.
- An initial prompt targets the selected entry as a fresh `user-request`.

### Web Interaction

- For a workflow selected from the catalog, the existing workflow-detail query supplies an ordered step selector.
- The selector defaults to `Default (first step)` and resets whenever the workflow changes.
- Manual workflow paths use an optional exact step-ID text input because arbitrary paths cannot safely be read through the existing workflow CRUD API.
- A server rejection remains inline on the form and preserves all entered values.

### Terminal/TUI Interaction

- The launch syntax is `workflow-runner start <workflow.json> --step <step-id>` with the matching `--step=<step-id>` form.
- The selected step changes only the daemon start payload; existing attached TUI, detached, and non-TTY output behavior is preserved.
- Invalid flag shape fails locally; an ID absent from the workflow fails through the existing workflow-invalid error path.

### Agent's Discretion

- Exact helper/component boundaries for parsing workflow JSON into selector options.
- Selector copy and concise loading/error text, while preserving current visual patterns and accessibility.
- Whether the run manager accepts a structured options object or an additional parameter, provided call-site clarity and compatibility are maintained.

### Declined / Undiscussed Gray Areas → Assumptions

- No separate full-screen terminal picker will be added; `start --step` is the TUI launch control.
- Web catalog workflows receive a populated selector; manual paths receive text entry.
- Step IDs remain exact and case-sensitive rather than normalized.

These defaults are recorded in the specification's Assumptions & Open Questions table and were confirmed by the user on 2026-07-01.

---

## Specific References

- Follow the existing `--branch` and `--prompt` argument forms and error behavior.
- Reuse the existing scoped workflow list/detail queries for the web selector.
- Reuse `Runner.run(startStepId, startInbound)` rather than adding alternate execution logic.

---

## Deferred Ideas

- Interactive terminal workflow/step browsing.
- Restarting an existing run from an arbitrary historical step.
- Dependency-aware execution of selected-step predecessors.
