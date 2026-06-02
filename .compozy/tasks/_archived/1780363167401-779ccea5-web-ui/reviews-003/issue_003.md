---
provider: manual
pr:
round: 3
round_created_at: 2026-06-01T13:45:01Z
status: resolved
file: web/src/features/run-view/RunControls.tsx
line: 32
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Stop/Retry stay enabled after the socket closes, unlike the input box

## Review Comment

Round 2 (`reviews-002/issue_001`) fixed the chat input so it is disabled once the
socket is no longer live:

```tsx
<InputBox enabled={vm.interactiveEnabled && !vm.closed && vm.status === 'running'} ... />
```

The same reasoning was not applied to the inline run controls. `RunControls`
derives availability purely from `status` and ignores `vm.closed`:

```tsx
const canStop = status === 'running'
const canRetry = status !== null && RETRYABLE_STATUSES.includes(status)
```

`RunView` passes only `status` and `summary` down, never `vm.closed`. So after a
socket close — e.g. the idle timeout closes a still-`running` connection (see
issue 001), a daemon shutdown, or an overflow — the view shows "Connection
closed." while **Stop** (status still `running`) or **Retry step** (status
`failed`/`crashed`/`aborted`) remain clickable.

Clicking them does hit the API and the dashboard reflects the result via the
`['runs']` invalidation, but the focused live view is frozen and cannot show the
outcome (no reconnect in the MVP). This is the same "action fires, view gives no
feedback" inconsistency that round 2 fixed for the input box, just on the control
surface instead. The PRD calls out that stop/retry should "reflect the correct
resulting status ... in both the live view and dashboard."

Suggested fix: thread `vm.closed` into `RunControls` and disable the buttons (or
otherwise signal that the live view is detached) when the socket is closed, e.g.
`disabled={!canStop || stopMutation.isPending || closed}`, keeping the control
surface consistent with the already-gated `InputBox`.

## Triage

- Decision: `valid`
- Notes: The issue is confirmed. `RunControls` derives button availability purely from `status` and never receives `vm.closed`. `RunView` passes only `status` and `summary` to `RunControls`, omitting `vm.closed`. The `InputBox` was already gated with `!vm.closed` in round 2 (line 37 of `RunView.tsx`), but `RunControls` was not updated consistently. Fix: add `closed?: boolean` prop to `RunControlsProps`, apply it in the disabled conditions for both Stop (`!canStop || stopMutation.isPending || closed`) and Retry (`!canRetry || retryMutation.isPending || closed`), and thread `vm.closed` from `RunView` into `RunControls`.
