---
provider: manual
pr:
round: 1
round_created_at: 2026-06-02T15:03:58Z
status: resolved
file: src/infra/acp/ide-profiles.ts
line: 71
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Four configureSession bodies are byte-for-byte duplicates

## Review Comment

`opencodeProfile`, `claudeCodeProfile`, `codexProfile`, and `geminiProfile`
each define a `configureSession` that is identical character-for-character
(lines 40-68, 77-105, 114-142, 151-179). The only thing that actually differs
between the four profiles is `id` and `spawn`; the mode/model logic is copied
four times.

This directly undercuts the architecture's stated justification. ADR-002 and
`_techspec.md` accept the `IdeProfile` table specifically because "per-agent
ACP quirks concentrate in `configureSession`" — but in the implementation no
agent has any quirk, so ~30 lines are duplicated 4×. Any future fix to the
mode-validation / `setSessionMode` / `unstable_setSessionModel` sequence must
be made in four places, with obvious drift risk.

Suggested fix: extract the shared sequence into one helper and reference it from
each profile, leaving only genuinely agent-specific code in a profile's own hook:

```ts
async function configureStandardSession(args: ConfigureArgs): Promise<void> {
  const modeIds = availableModeIds(args.session);
  // ...the current shared body...
}

const claudeCodeProfile: IdeProfile = {
  id: "claude-code",
  spawn: { command: "claude", args: ["--acp"] },
  configureSession: configureStandardSession,
};
```

## Triage

- Decision: `valid`
- Notes: Confirmed — all four `configureSession` bodies in `ide-profiles.ts` are byte-for-byte identical (lines 40-68, 77-105, 114-142, 151-179). The only differences between profiles are `id` and `spawn`. Fix: extract into a single `configureStandardSession` async function and assign it to each profile's `configureSession` property. The existing tests exercise behavior via each profile and will continue to pass after the refactor since behavior is unchanged.
