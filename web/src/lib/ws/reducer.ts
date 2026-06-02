import { RunnerEventSchema } from '../api/client'
import type { AttachFrame, RunDetail, RunStatus } from '../api/types'

export interface TranscriptItem {
  kind: 'step' | 'message' | 'log' | 'status'
  stepId: string | null
  text: string
  seqStart: number
  seqEnd: number
  streamKind?: string
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
    case 'summary':
      return { ...vm, appliedSeqs: addSeq(), summary: event.summary }
    default:
      return vm
  }
}
