---
provider: manual
pr:
round: 1
round_created_at: 2026-06-09T10:50:28Z
status: resolved
file: web/src/lib/ws/reducer.ts
line: 160
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Web fold does a full O(n) transcript scan per tool_call update

## Review Comment

Every `tool_call` update runs `vm.transcript.findIndex(...)` over the whole
transcript to locate the row to replace. With one call producing 2–4 updates
(ADR-002) and updates interleaved with messages/logs, a run with many tool
calls is O(n·m) — each update rescans an ever-growing array. The TUI avoids
this with a `Map<toolCallId, entry>` for O(1) lookup
(`src/infra/tui/tui.ts:85`); the web surface is the asymmetric one here.

This touches the PRD constraint that "in-place updates must not degrade web
rendering for runs with many tool calls." In practice transcripts are bounded
and React re-render cost dominates, so impact is minor — hence low severity —
but the asymmetry is avoidable.

**Suggested fix (optional):** if Issue 001's per-step scoping lands, the scan
is already bounded to the current step's rows. If further optimization is
wanted, maintain a `Map<toolCallId, index>` alongside the transcript (reset on
banner) so the fold is O(1), keeping the web behavior on par with the TUI.

## Triage

- Decision: `VALID`
- Root cause: the `tool_call` fold located its row with
  `vm.transcript.findIndex(...)`, an O(n) scan of the whole (append-only)
  transcript on every update. With 2–4 updates per call (ADR-002) interleaved
  with messages/logs, a run with many tool calls degraded to O(n·m), and the
  web surface was asymmetric with the TUI's O(1) `Map<toolCallId, entry>`
  (`src/infra/tui/tui.ts`).
- Fix: added `toolCallIndex: Map<string, number>` to `RunViewModel` (seeded
  empty in `initialViewModel`), keyed by a `JSON.stringify([stepId, toolCallId])`
  composite key. The fold now does an O(1) `Map.get`. Because transcript rows
  are only ever appended or replaced in place — never removed or reordered —
  stored indices never go stale, so no banner-reset is needed. The composite
  key preserves the exact per-step scoping the previous `findIndex` predicate
  enforced (`toolCallId === ... && stepId === ...`), so a reused id in a later
  step still starts a new row. JSON encoding (rather than a delimiter-joined
  string) guarantees a null `stepId` and any literal string value can never
  alias one another.
- Immutability preserved: the append path clones the map (`new Map(...)`)
  before inserting; the in-place-replace path leaves the map untouched and
  reuses the reference, so the reducer never mutates its input.
- Tests: added regression tests in `reducer.test.ts` covering index→row
  mapping, correct in-place folding across 50 interleaved tool calls (guards
  the index-map under growth), and the null-vs-string-`stepId` no-alias
  property. All pre-existing tool-call fold tests continue to pass unchanged.
- Verification: `bun run typecheck` (web, exit 0) and `npm test` (web) — 27
  files / 409 tests passed.
- Notes: change is constrained to the in-scope file `web/src/lib/ws/reducer.ts`
  plus its companion test file `reducer.test.ts`.
