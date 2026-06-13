---
provider: manual
pr:
round: 1
round_created_at: 2026-06-12T14:08:41Z
status: resolved
file: web/src/features/run-view/RunView.tsx
line: 43
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Initial prompt is a header banner, not shown in the web chat transcript

## Review Comment

On the web run view, the initial prompt is rendered only as a static header
banner above the transcript (`RunView.tsx:43-53`, `data-testid="initial-prompt-info"`),
sitting outside the chat flow. It never appears inside the `Transcript`
(`RunView.tsx:75`, fed by `vm.transcript`), so when reading the conversation the
user does not see the prompt as the first message of the chat — the agent's
responses appear to start with no visible user request. This is the behavior the
reporter observed ("can't see initial prompt at chat on web").

This also diverges from the TUI, which injects the prompt **into** the transcript
as the opening entry, rendered exactly like a typed user message:

```ts
// src/infra/tui/tui.ts — showInitialPrompt
showInitialPrompt(prompt?: string): void {
  if (!prompt) return;
  this.appendLog(`> ${prompt}`, C.blue); // same `> {text}` form submitInput uses
}
```

The PRD frames this capability as "shown in the run view (web **and** TUI
transcript)" and the reviewer story is "opening any run, the reviewer sees the
prompt the run was started with." Having the prompt live in the chat as the first
user turn (matching the TUI) is the more discoverable, consistent presentation.

Note: ADR-003 specified the web rendering as "its own labeled section in
RunView," so the current banner is implemented as designed — but it does not match
the TUI transcript treatment and is not where users look for it. If the chat is
the intended home, surface the prompt as the leading transcript item (a
user-role entry) so web and TUI agree; the header banner can then be removed or
kept only as supplementary run metadata.

Suggested fix: prepend the initial prompt to the transcript as a synthetic
user/request entry (mirroring `Tui.showInitialPrompt`) so it renders as the first
message in `Transcript`, and reconcile with the existing banner so the prompt is
not shown twice. Add a `RunView`/`Transcript` test asserting the prompt appears as
the opening chat message when present and is absent otherwise.

## Triage

- Decision: `VALID`
- Root cause: In `web/src/features/run-view/RunView.tsx` the initial prompt was
  rendered only as a static header banner (`data-testid="initial-prompt-info"`,
  lines 43-53), sitting outside the chat flow. It was never part of `vm.transcript`
  (fed to `<Transcript>`), so when reading the conversation the user never saw the
  prompt as the first message — the agent's responses appeared to start with no
  visible user request. This diverges from the TUI (`Tui.showInitialPrompt`,
  `src/infra/tui/tui.ts:510`), which injects the prompt **into** the transcript as
  the opening entry in the same `> {text}` form a typed user message uses.
- Fix approach (matches the reviewer's suggested fix and the TUI):
  - Remove the standalone header banner.
  - Prepend a synthetic `message` transcript item carrying the initial prompt as
    the leading chat entry, quoting each line with `> ` so it reads as the user's
    request (mirroring `Tui.showInitialPrompt`'s `> {prompt}`) and renders through
    Streamdown as a blockquote, visually distinct from agent output.
  - Prepend at render time in `RunView` (not in the reducer) so it never
    interferes with stream coalescing or seq de-duplication — the synthetic item
    uses a sentinel `seqStart`/`seqEnd` of `-1`, which cannot collide with real
    non-negative event-log seq numbers used for React keys.
  - The prompt is now shown once (in the transcript), reconciling the previous
    double-surface concern.
- Scope note: the fix is fully contained in the in-scope file
  `web/src/features/run-view/RunView.tsx`; only its test file was updated to
  assert the new transcript behavior.
