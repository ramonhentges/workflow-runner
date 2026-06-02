# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement the WS attach client + view-model reducer under `web/src/lib/ws/`:
- `reducer.ts`: pure `reduceFrame` + `reduceEntry` with stream coalescing
- `attach-client.ts`: socket wrapper with `subscribe`/`sendInput`/`close` + `openAttach`
- `use-attach.ts`: React hook returning `{ vm, sendInput }`
- Tests: 78 tests passing, 98.48% statement coverage

## Important Decisions

- `RunViewModel` extended with `closed: boolean` (not in TechSpec spec) to surface socket close to subscribers. Required because the only subscriber channel is `onModel`, and there is no separate close callback in the AttachClient interface.
- `TranscriptItem` extended with `streamKind?: string` to enable per-(stepId, stream.kind) coalescing. The TechSpec's union type is `kind: 'step' | 'message' | 'log' | 'status'`; `streamKind` is supplemental internal data.
- Reducer validates `entry.event` with `RunnerEventSchema.safeParse()` at runtime (even though the TS type says `RunnerEvent`) because Zod uses `z.unknown()` for that field at the wire level.
- Cast in attach-client: `result.data as unknown as AttachFrame` — the Zod-inferred type and the `AttachFrame` type differ only in `event: unknown` vs `event: RunnerEvent`; the reducer handles the difference.
- `use-attach.ts` URL transform: `baseUrl.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))` — covers both http→ws and https→wss.

## Learnings

- FakeWebSocket class needs to be defined per-test-file (not shared) since the global stub is test-file scoped.
- `vi.stubGlobal('WebSocket', FakeWebSocket)` + `vi.unstubAllGlobals()` in beforeEach/afterEach is the correct pattern for WS testing in Vitest/jsdom.
- The default cases in switch statements over Zod-validated discriminated unions are unreachable at runtime (Zod filters before reaching the reducer). Lines 54 and 136 in reducer.ts are safety nets; 2% uncovered is acceptable.
- The `use-attach.ts` line 19 branch (`https→wss` regex alternative) is uncovered (only `http→ws` tested); 50% branch for that file only.

## Files / Surfaces

- `web/src/lib/ws/reducer.ts` — new: TranscriptItem, RunViewModel, initialViewModel, reduceFrame
- `web/src/lib/ws/attach-client.ts` — new: AttachClient interface, openAttach
- `web/src/lib/ws/use-attach.ts` — new: useAttach hook
- `web/src/lib/ws/reducer.test.ts` — new: 33 unit tests for reducer
- `web/src/lib/ws/attach-client.test.ts` — new: 22 integration tests with FakeWebSocket
- `web/src/lib/ws/use-attach.test.ts` — new: 6 hook tests via RTL renderHook

## Errors / Corrections

- Initial implementation used `// biome-ignore` comment for `as any` cast — removed; project uses TypeScript not Biome. Changed to `as unknown as AttachFrame`.
- First test run: `use-attach.ts` was 0% coverage — added `use-attach.test.ts` to bring it to 100% statements.

## Ready for Next Run

Task complete. `web/src/lib/ws/` is fully implemented and tested.
- task_10 (Live run view) can now consume `useAttach` hook and `RunViewModel`.
- `sendInput` is exposed from the hook; `close` is handled by useEffect cleanup.
- No reconnect in MVP (as per ADR-005).
