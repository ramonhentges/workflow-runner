import { RunnerEventSchema } from '../api/client'
import type { AttachFrame, RunDetail, RunStatus, ToolCallStatus } from '../api/types'

export interface TranscriptItem {
  kind: 'step' | 'message' | 'log' | 'status' | 'tool_call'
  stepId: string | null
  text: string
  seqStart: number
  seqEnd: number
  streamKind?: string
  // Tool-call fields, set only when kind === 'tool_call'. `text` holds the title;
  // the row is folded by `toolCallId` (ADR-002, last-wins).
  toolCallId?: string
  status?: ToolCallStatus
  errorText?: string
}

export interface RunViewModel {
  snapshot: RunDetail | null
  transcript: TranscriptItem[]
  steps: { id: string; index: number; active: boolean }[]
  status: RunStatus | null
  interactiveEnabled: boolean
  summary: unknown | null
  error: { code: string; message: string } | null
  closed: boolean
  backlogTruncated: boolean
  appliedSeqs: Set<number>
  // Maps a (stepId, toolCallId) key to the index of its row in `transcript`,
  // giving the tool-call fold an O(1) lookup instead of an O(n) scan per update
  // (mirrors the TUI's `Map<toolCallId, entry>`). Rows are only ever appended or
  // replaced in place, so stored indices never go stale.
  toolCallIndex: Map<string, number>
}

export const initialViewModel: RunViewModel = {
  snapshot: null,
  transcript: [],
  steps: [],
  status: null,
  interactiveEnabled: false,
  summary: null,
  error: null,
  closed: false,
  backlogTruncated: false,
  appliedSeqs: new Set(),
  toolCallIndex: new Map(),
}

export function reduceFrame(vm: RunViewModel, frame: AttachFrame): RunViewModel {
  switch (frame.type) {
    case 'snapshot': {
      const { visitedStepIds, currentStepId } = frame.snapshot
      const seededSteps = visitedStepIds.map((id, index) => ({
        id,
        index,
        active: id === currentStepId,
      }))
      return { ...vm, snapshot: frame.snapshot, status: frame.snapshot.status, steps: seededSteps }
    }
    case 'backlog': {
      const sorted = frame.entries.slice().sort((a, b) => a.seq - b.seq)
      let result = { ...vm, backlogTruncated: frame.truncated }
      for (const entry of sorted) {
        result = reduceEntry(result, entry.seq, entry.stepId, entry.event)
      }
      return result
    }
    case 'event':
      return reduceEntry(vm, frame.entry.seq, frame.entry.stepId, frame.entry.event)
    case 'status':
      return { ...vm, status: frame.status }
    case 'error':
      return { ...vm, error: { code: frame.code, message: frame.message } }
    default:
      return vm
  }
}

// Composite key for the tool-call index. JSON encoding keeps the two segments
// unambiguous — a null stepId and the literal string "null" (or any delimiter
// char a stepId/toolCallId might contain) all serialize distinctly — so no pair
// can alias another, exactly matching the previous findIndex equality check.
function toolCallKey(stepId: string | null, toolCallId: string): string {
  return JSON.stringify([stepId, toolCallId])
}

function reduceEntry(
  vm: RunViewModel,
  seq: number,
  stepId: string | null,
  rawEvent: unknown,
): RunViewModel {
  if (vm.appliedSeqs.has(seq)) return vm

  const parsed = RunnerEventSchema.safeParse(rawEvent)
  if (!parsed.success) return vm

  const event = parsed.data
  const addSeq = (): Set<number> => { const s = new Set(vm.appliedSeqs); s.add(seq); return s }

  switch (event.type) {
    case 'banner': {
      const steps = vm.steps.map(s => ({ ...s, active: false }))
      const exists = steps.some(s => s.id === event.step.id)
      const newSteps = exists
        ? steps.map(s => (s.id === event.step.id ? { ...s, active: true } : s))
        : [...steps, { id: event.step.id, index: event.index, active: true }]
      return {
        ...vm,
        appliedSeqs: addSeq(),
        steps: newSteps,
        transcript: [
          ...vm.transcript,
          { kind: 'step', stepId: event.step.id, text: event.step.id, seqStart: seq, seqEnd: seq },
        ],
      }
    }
    case 'log':
      return {
        ...vm,
        appliedSeqs: addSeq(),
        transcript: [
          ...vm.transcript,
          { kind: 'log', stepId, text: event.message, seqStart: seq, seqEnd: seq },
        ],
      }
    case 'stream': {
      const last = vm.transcript[vm.transcript.length - 1]
      if (
        last &&
        last.kind === 'message' &&
        last.stepId === stepId &&
        last.streamKind === event.kind
      ) {
        return {
          ...vm,
          appliedSeqs: addSeq(),
          transcript: [
            ...vm.transcript.slice(0, -1),
            { ...last, text: last.text + event.chunk, seqEnd: seq },
          ],
        }
      }
      return {
        ...vm,
        appliedSeqs: addSeq(),
        transcript: [
          ...vm.transcript,
          {
            kind: 'message',
            stepId,
            text: event.chunk,
            seqStart: seq,
            seqEnd: seq,
            streamKind: event.kind,
          },
        ],
      }
    }
    case 'interactive':
      return { ...vm, appliedSeqs: addSeq(), interactiveEnabled: event.enabled }
    case 'status':
      return {
        ...vm,
        appliedSeqs: addSeq(),
        transcript: [
          ...vm.transcript,
          { kind: 'status', stepId, text: event.text, seqStart: seq, seqEnd: seq },
        ],
      }
    case 'tool_call': {
      const { call } = event
      // Scope the fold to the current step, mirroring the TUI which clears its
      // tool-call map on each banner. Tool-call ids are unique per session
      // (per step), not per run; several adapters restart sequential ids
      // (`call_0`, `call_1`, …) each session, so a reused id in a later step
      // must start a new row rather than mutating the earlier step's line. The
      // (stepId, toolCallId) key makes the lookup O(1) and step-scoped at once.
      const key = toolCallKey(stepId, call.toolCallId)
      const idx = vm.toolCallIndex.get(key)
      // First event for this id: append a new row at the end (first-seen position)
      // and record its index so later updates skip the scan.
      if (idx === undefined) {
        const nextIndex = new Map(vm.toolCallIndex)
        nextIndex.set(key, vm.transcript.length)
        return {
          ...vm,
          appliedSeqs: addSeq(),
          toolCallIndex: nextIndex,
          transcript: [
            ...vm.transcript,
            {
              kind: 'tool_call',
              stepId,
              text: call.title,
              seqStart: seq,
              seqEnd: seq,
              toolCallId: call.toolCallId,
              status: call.status,
              errorText: call.errorText,
            },
          ],
        }
      }
      // Later event: replace the existing row in place, keeping seqStart/position.
      const transcript = vm.transcript.slice()
      transcript[idx] = {
        ...transcript[idx],
        text: call.title,
        status: call.status,
        errorText: call.errorText,
        seqEnd: seq,
      }
      return { ...vm, appliedSeqs: addSeq(), transcript }
    }
    case 'summary':
      return { ...vm, appliedSeqs: addSeq(), summary: event.summary }
    default:
      return vm
  }
}
