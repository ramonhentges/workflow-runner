---
provider: manual
pr:
round: 1
round_created_at: 2026-06-02T15:03:58Z
status: resolved
file: src/infra/acp/ide-profiles.ts
line: 86
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: step.agent mapped to ACP mode is opencode-specific; breaks parity

## Review Comment

Every profile maps `step.agent` onto an ACP **mode** via
`setSessionMode({ modeId: step.agent })` and validates it against
`availableModeIds(...)`. That mapping is opencode-specific: opencode exposes
its personas/agents as the `mode` select (see the `availableModeIds` doc
comment, lines 8-16). For the other agents "mode" means something different —
e.g. Claude Code advertises *permission* modes (`default`, `acceptEdits`,
`plan`, `bypassPermissions`), not personas.

Concrete consequence: `workflows/multi-agent.json` declares the `plan` step
with `ide: "claude-code"` and `agent: "architect-advisor"`. If Claude Code
advertises permission modes, `availableModeIds` returns those, `"architect-advisor"`
is not among them, and `configureSession` throws
`agent 'architect-advisor' is not a valid mode` — the very first step of the
flagship four-agent fixture fails. This conflicts with the PRD success
criterion ("a single workflow that uses all four agents runs end to end") and
the full-parity goal.

`_techspec.md` defers per-agent persona/model mapping to "confirmed during
build / E2E," but the code shipped the opencode mechanism verbatim for all
four with no per-agent handling, so that confirmation has not happened.

Suggested fix: confirm each agent's actual persona/model ACP surface and give
non-opencode profiles a mapping that matches it (or, if an agent cannot honor
`agent`/`model`, reject with a clear step error rather than silently misusing
`setSessionMode`). At minimum, run the four-agent E2E in `README.md` before
merge and adjust the fixture/profiles to whatever the bridges actually accept.

## Triage

- Decision: `valid`
- Notes: All four profiles currently share `configureStandardSession`, which validates `step.agent`
  against the mode IDs returned by `availableModeIds`. For opencode this works correctly because
  its mode IDs are persona names. For claude-code, codex, and gemini the ACP `modes.availableModes`
  field (or configOptions fallback) exposes a different surface — claude-code in particular exposes
  permission modes (`default`, `acceptEdits`, `plan`, `bypassPermissions`), not personas. The
  moment any of those agents advertise *any* modes at all, `step.agent: "architect-advisor"` fails
  the `modeIds.includes(step.agent)` check and the step errors before making a single ACP call.
  This breaks the first step of the four-agent fixture.

  Fix: add a `configurePermissiveSession` for non-opencode profiles that skips the mode-validation
  guard and calls `setSessionMode` directly (wrapped in the same step-named error). If the IDE
  rejects the call, the error surfaces from the actual ACP response rather than a preemptive
  validation check. The test cases that currently assert a throw for claude-code/codex/gemini when
  the agent is not in the advertised mode list must be replaced with assertions that `setSessionMode`
  is called regardless.
