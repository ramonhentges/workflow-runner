import { describe, test, expect } from 'vitest'
import { reduceFrame, initialViewModel } from './reducer'
import type { RunViewModel } from './reducer'
import type { AttachFrame, RunDetail } from '../api/types'

function makeSnapshot(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: 'run-1',
    slug: 'abc',
    workflowPath: '/tmp/wf.json',
    status: 'running',
    currentStepId: null,
    visitedStepIds: [],
    startedAt: 1000,
    endedAt: null,
    attachedCount: 1,
    ...overrides,
  }
}

function reduce(frames: AttachFrame[], base: RunViewModel = initialViewModel): RunViewModel {
  return frames.reduce((vm, frame) => reduceFrame(vm, frame), base)
}

// Helper to make a run event entry
function runEvent(seq: number, stepId: string | null, event: unknown): { seq: number; ts: number; stepId: string | null; event: unknown } {
  return { seq, ts: seq * 1000, stepId, event }
}

describe('snapshot frame', () => {
  test('sets snapshot and derives status', () => {
    const snap = makeSnapshot({ status: 'running' })
    const vm = reduceFrame(initialViewModel, { type: 'snapshot', snapshot: snap })
    expect(vm.snapshot).toEqual(snap)
    expect(vm.status).toBe('running')
  })

  test('does not clear existing transcript', () => {
    const existing: RunViewModel = {
      ...initialViewModel,
      transcript: [{ kind: 'log', stepId: null, text: 'hello', seqStart: 1, seqEnd: 1 }],
    }
    const vm = reduceFrame(existing, { type: 'snapshot', snapshot: makeSnapshot() })
    expect(vm.transcript).toHaveLength(1)
  })
})

describe('snapshot step seeding', () => {
  test('seeds vm.steps from visitedStepIds with currentStepId active', () => {
    const snap = makeSnapshot({ visitedStepIds: ['a', 'b', 'c'], currentStepId: 'c' })
    const vm = reduceFrame(initialViewModel, { type: 'snapshot', snapshot: snap })
    expect(vm.steps).toHaveLength(3)
    expect(vm.steps[0]).toEqual({ id: 'a', index: 0, active: false })
    expect(vm.steps[1]).toEqual({ id: 'b', index: 1, active: false })
    expect(vm.steps[2]).toEqual({ id: 'c', index: 2, active: true })
  })

  test('snapshot with no visitedStepIds leaves steps empty', () => {
    const vm = reduceFrame(initialViewModel, { type: 'snapshot', snapshot: makeSnapshot() })
    expect(vm.steps).toHaveLength(0)
  })

  test('snapshot with visitedStepIds and null currentStepId marks all inactive', () => {
    const snap = makeSnapshot({ visitedStepIds: ['a', 'b'], currentStepId: null })
    const vm = reduceFrame(initialViewModel, { type: 'snapshot', snapshot: snap })
    expect(vm.steps.every(s => !s.active)).toBe(true)
  })

  test('banner for snapshot-seeded step re-activates it without duplicating', () => {
    const snap = makeSnapshot({ visitedStepIds: ['a', 'b', 'c'], currentStepId: 'c' })
    const frames: AttachFrame[] = [
      { type: 'snapshot', snapshot: snap },
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'c' }, index: 2 }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.steps).toHaveLength(3)
    expect(vm.steps.find(s => s.id === 'c')?.active).toBe(true)
    expect(vm.steps.filter(s => s.active)).toHaveLength(1)
  })

  test('banner for new step after snapshot correctly deactivates snapshot steps', () => {
    const snap = makeSnapshot({ visitedStepIds: ['a', 'b'], currentStepId: 'b' })
    const frames: AttachFrame[] = [
      { type: 'snapshot', snapshot: snap },
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'c' }, index: 2 }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.steps).toHaveLength(3)
    expect(vm.steps.find(s => s.id === 'a')?.active).toBe(false)
    expect(vm.steps.find(s => s.id === 'b')?.active).toBe(false)
    expect(vm.steps.find(s => s.id === 'c')?.active).toBe(true)
  })
})

describe('stream chunk coalescing', () => {
  test('two consecutive stream chunks with same (stepId, kind) coalesce into one transcript item', () => {
    const frames: AttachFrame[] = [
      { type: 'snapshot', snapshot: makeSnapshot() },
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'hello ' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, 'step-1', { type: 'stream', kind: 'output', chunk: 'world' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].kind).toBe('message')
    expect(vm.transcript[0].text).toBe('hello world')
    expect(vm.transcript[0].seqStart).toBe(1)
    expect(vm.transcript[0].seqEnd).toBe(2)
    expect(vm.transcript[0].stepId).toBe('step-1')
  })

  test('stream chunks with different kind do not coalesce', () => {
    const frames: AttachFrame[] = [
      { type: 'snapshot', snapshot: makeSnapshot() },
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'a' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, 'step-1', { type: 'stream', kind: 'error', chunk: 'b' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(2)
    expect(vm.transcript[0].text).toBe('a')
    expect(vm.transcript[1].text).toBe('b')
  })

  test('stream chunks with different stepId do not coalesce', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'a' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, 'step-2', { type: 'stream', kind: 'output', chunk: 'b' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(2)
  })

  test('non-stream event between stream chunks breaks coalescing', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'a' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, 'step-1', { type: 'log', message: 'interruption' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(3, 'step-1', { type: 'stream', kind: 'output', chunk: 'b' }) as any,
      },
    ]
    const vm = reduce(frames)
    // stream, log, stream → 3 items
    expect(vm.transcript).toHaveLength(3)
    expect(vm.transcript[0].text).toBe('a')
    expect(vm.transcript[1].kind).toBe('log')
    expect(vm.transcript[2].text).toBe('b')
  })
})

describe('banner events', () => {
  test('adds a step to steps and marks it active with a transcript entry', () => {
    const frame: AttachFrame = {
      type: 'event',
      entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
    }
    const vm = reduceFrame(initialViewModel, frame)
    expect(vm.steps).toHaveLength(1)
    expect(vm.steps[0]).toEqual({ id: 'step-1', index: 0, active: true })
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].kind).toBe('step')
    expect(vm.transcript[0].stepId).toBe('step-1')
  })

  test('second banner marks previous step inactive and new one active', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, null, { type: 'banner', step: { id: 'step-2' }, index: 1 }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.steps).toHaveLength(2)
    expect(vm.steps.find(s => s.id === 'step-1')?.active).toBe(false)
    expect(vm.steps.find(s => s.id === 'step-2')?.active).toBe(true)
  })

  test('banner for existing step re-activates it without duplicating', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
      },
      {
        type: 'event',
        entry: runEvent(2, null, { type: 'banner', step: { id: 'step-2' }, index: 1 }) as any,
      },
      {
        type: 'event',
        entry: runEvent(3, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.steps).toHaveLength(2)
    expect(vm.steps.find(s => s.id === 'step-1')?.active).toBe(true)
    expect(vm.steps.find(s => s.id === 'step-2')?.active).toBe(false)
  })
})

describe('interactive event', () => {
  test('{enabled:true} sets interactiveEnabled=true', () => {
    const vm = reduceFrame(initialViewModel, {
      type: 'event',
      entry: runEvent(1, null, { type: 'interactive', enabled: true }) as any,
    })
    expect(vm.interactiveEnabled).toBe(true)
  })

  test('{enabled:false} clears interactiveEnabled', () => {
    const after = reduceFrame(
      { ...initialViewModel, interactiveEnabled: true },
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'interactive', enabled: false }) as any,
      },
    )
    expect(after.interactiveEnabled).toBe(false)
  })
})

describe('status frame (AttachFrame)', () => {
  test('updates status field', () => {
    const vm = reduceFrame(initialViewModel, { type: 'status', status: 'completed' })
    expect(vm.status).toBe('completed')
  })
})

describe('status event (RunnerEvent)', () => {
  test('adds a status transcript item', () => {
    const vm = reduceFrame(initialViewModel, {
      type: 'event',
      entry: runEvent(1, 'step-1', { type: 'status', text: 'Running step...' }) as any,
    })
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].kind).toBe('status')
    expect(vm.transcript[0].text).toBe('Running step...')
    expect(vm.transcript[0].stepId).toBe('step-1')
  })
})

describe('summary event', () => {
  test('populates summary field', () => {
    const payload = { result: 'all done', score: 42 }
    const vm = reduceFrame(initialViewModel, {
      type: 'event',
      entry: runEvent(1, null, { type: 'summary', summary: payload }) as any,
    })
    expect(vm.summary).toEqual(payload)
  })
})

describe('error frame', () => {
  test('populates error without discarding existing transcript', () => {
    const withTranscript: RunViewModel = {
      ...initialViewModel,
      transcript: [{ kind: 'log', stepId: null, text: 'hello', seqStart: 1, seqEnd: 1 }],
    }
    const vm = reduceFrame(withTranscript, {
      type: 'error',
      code: 'OVERFLOW',
      message: 'too many events',
    })
    expect(vm.error).toEqual({ code: 'OVERFLOW', message: 'too many events' })
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].text).toBe('hello')
  })
})

describe('backlog frame', () => {
  test('folds entries in seq order regardless of arrival order', () => {
    const entries = [
      runEvent(3, 'step-1', { type: 'stream', kind: 'output', chunk: 'c' }),
      runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'a' }),
      runEvent(2, 'step-1', { type: 'stream', kind: 'output', chunk: 'b' }),
    ]
    const vm = reduceFrame(initialViewModel, {
      type: 'backlog',
      entries: entries as any,
      truncated: false,
    })
    // All same (stepId, kind) → should coalesce in seq order: a, b, c
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].text).toBe('abc')
    expect(vm.transcript[0].seqStart).toBe(1)
    expect(vm.transcript[0].seqEnd).toBe(3)
  })

  test('backlog with truncated:false sets backlogTruncated to false', () => {
    const vm = reduceFrame(initialViewModel, {
      type: 'backlog',
      entries: [],
      truncated: false,
    })
    expect(vm.backlogTruncated).toBe(false)
  })

  test('backlog with truncated:true sets backlogTruncated to true', () => {
    const vm = reduceFrame(initialViewModel, {
      type: 'backlog',
      entries: [runEvent(5, 'step-1', { type: 'log', message: 'partial' })] as any,
      truncated: true,
    })
    expect(vm.backlogTruncated).toBe(true)
    expect(vm.transcript).toHaveLength(1)
  })

  test('backlog entries are folded before subsequent live event frames', () => {
    const frames: AttachFrame[] = [
      {
        type: 'backlog',
        entries: [runEvent(1, 'step-1', { type: 'log', message: 'from backlog' })] as any,
        truncated: false,
      },
      {
        type: 'event',
        entry: runEvent(2, 'step-1', { type: 'log', message: 'live event' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(2)
    expect(vm.transcript[0].text).toBe('from backlog')
    expect(vm.transcript[1].text).toBe('live event')
  })
})

describe('seq deduplication', () => {
  test('duplicate event frame with same seq is ignored', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'log', message: 'first' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'log', message: 'first' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].text).toBe('first')
  })

  test('backlog entry whose seq was already applied as a live event is skipped', () => {
    // Simulates the race: live event arrives during gap-read, then backlog contains same seq
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(5, 'step-1', { type: 'log', message: 'live' }) as any,
      },
      {
        type: 'backlog',
        entries: [
          runEvent(3, 'step-1', { type: 'log', message: 'earlier' }),
          runEvent(5, 'step-1', { type: 'log', message: 'live' }),
        ] as any,
        truncated: false,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(2)
    expect(vm.transcript[0].text).toBe('live')    // from live event frame
    expect(vm.transcript[1].text).toBe('earlier') // from backlog (seq=3, new)
  })

  test('duplicate banner seq does not duplicate step header in transcript', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
      },
      {
        type: 'event',
        entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.steps).toHaveLength(1)
  })

  test('duplicate stream seq does not double-append or mis-coalesce', () => {
    const frames: AttachFrame[] = [
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'hello' }) as any,
      },
      {
        type: 'event',
        entry: runEvent(1, 'step-1', { type: 'stream', kind: 'output', chunk: 'hello' }) as any,
      },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].text).toBe('hello')
  })
})

describe('tool_call folding', () => {
  function toolCall(
    toolCallId: string,
    status: string,
    title: string,
    errorText?: string,
  ): unknown {
    return {
      type: 'tool_call',
      call: { toolCallId, status, kind: 'execute', title, ...(errorText ? { errorText } : {}) },
    }
  }

  test('three events with one toolCallId fold into a single completed item', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: npm test')) as any },
      { type: 'event', entry: runEvent(2, 'step-1', toolCall('tc-1', 'in_progress', 'Bash: npm test')) as any },
      { type: 'event', entry: runEvent(3, 'step-1', toolCall('tc-1', 'completed', 'Bash: npm test')) as any },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    const item = vm.transcript[0]
    expect(item.kind).toBe('tool_call')
    expect(item.toolCallId).toBe('tc-1')
    expect(item.status).toBe('completed')
    expect(item.text).toBe('Bash: npm test')
    expect(item.seqStart).toBe(1)
    expect(item.seqEnd).toBe(3)
    expect(item.stepId).toBe('step-1')
  })

  test('a failed event sets errorText on the existing item', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'in_progress', 'Bash: npm test')) as any },
      { type: 'event', entry: runEvent(2, 'step-1', toolCall('tc-1', 'failed', 'Bash: npm test', 'exit code 1')) as any },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].status).toBe('failed')
    expect(vm.transcript[0].errorText).toBe('exit code 1')
  })

  test('two interleaved toolCallIds produce two items, each in first-seen position', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')) as any },
      { type: 'event', entry: runEvent(2, 'step-1', toolCall('tc-2', 'pending', 'Bash: b')) as any },
      { type: 'event', entry: runEvent(3, 'step-1', toolCall('tc-1', 'completed', 'Bash: a')) as any },
      { type: 'event', entry: runEvent(4, 'step-1', toolCall('tc-2', 'completed', 'Bash: b')) as any },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(2)
    expect(vm.transcript[0].toolCallId).toBe('tc-1')
    expect(vm.transcript[0].status).toBe('completed')
    expect(vm.transcript[1].toolCallId).toBe('tc-2')
    expect(vm.transcript[1].status).toBe('completed')
  })

  test('a tool_call update after unrelated log/stream still updates the original row', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')) as any },
      { type: 'event', entry: runEvent(2, 'step-1', { type: 'log', message: 'note' }) as any },
      { type: 'event', entry: runEvent(3, 'step-1', { type: 'stream', kind: 'output', chunk: 'x' }) as any },
      { type: 'event', entry: runEvent(4, 'step-1', toolCall('tc-1', 'completed', 'Bash: a')) as any },
    ]
    const vm = reduce(frames)
    // tool_call, log, stream → 3 rows; the tool_call row stays first and is updated.
    expect(vm.transcript).toHaveLength(3)
    expect(vm.transcript[0].kind).toBe('tool_call')
    expect(vm.transcript[0].status).toBe('completed')
    expect(vm.transcript[0].seqEnd).toBe(4)
    expect(vm.transcript[1].kind).toBe('log')
    expect(vm.transcript[2].kind).toBe('message')
  })

  test('appliedSeqs prevents double application of a repeated tool_call seq', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')) as any },
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')) as any },
    ]
    const vm = reduce(frames)
    expect(vm.transcript).toHaveLength(1)
    expect(vm.transcript[0].status).toBe('pending')
  })

  test('a re-seen toolCallId in a new step creates a new row (per-step fold)', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, null, { type: 'banner', step: { id: 'step-1' }, index: 0 }) as any },
      { type: 'event', entry: runEvent(2, 'step-1', toolCall('tc-1', 'completed', 'Read file.ts')) as any },
      { type: 'event', entry: runEvent(3, null, { type: 'banner', step: { id: 'step-2' }, index: 1 }) as any },
      { type: 'event', entry: runEvent(4, 'step-2', toolCall('tc-1', 'completed', 'Read file.ts')) as any },
    ]
    const vm = reduce(frames)
    const toolCalls = vm.transcript.filter(item => item.kind === 'tool_call')
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0].stepId).toBe('step-1')
    expect(toolCalls[1].stepId).toBe('step-2')
  })

  test('toolCallIndex maps (stepId, toolCallId) to the row index for O(1) updates', () => {
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')) as any },
      { type: 'event', entry: runEvent(2, 'step-1', { type: 'log', message: 'note' }) as any },
      { type: 'event', entry: runEvent(3, 'step-1', toolCall('tc-2', 'pending', 'Bash: b')) as any },
    ]
    const vm = reduce(frames)
    expect(vm.toolCallIndex.get(JSON.stringify(['step-1', 'tc-1']))).toBe(0)
    expect(vm.toolCallIndex.get(JSON.stringify(['step-1', 'tc-2']))).toBe(2)
  })

  test('many interleaved tool calls update the correct rows in place', () => {
    // Open 50 tool calls (interleaved with logs so they are not contiguous),
    // then complete each. The index map must resolve every later update to the
    // row it first appended, regardless of how large the transcript has grown.
    const N = 50
    const frames: AttachFrame[] = []
    let seq = 1
    for (let i = 0; i < N; i++) {
      frames.push({ type: 'event', entry: runEvent(seq++, 'step-1', toolCall(`tc-${i}`, 'pending', `Bash: ${i}`)) as any })
      frames.push({ type: 'event', entry: runEvent(seq++, 'step-1', { type: 'log', message: `log ${i}` }) as any })
    }
    for (let i = 0; i < N; i++) {
      frames.push({ type: 'event', entry: runEvent(seq++, 'step-1', toolCall(`tc-${i}`, 'completed', `Bash: ${i}`)) as any })
    }
    const vm = reduce(frames)
    const toolCalls = vm.transcript.filter(item => item.kind === 'tool_call')
    expect(toolCalls).toHaveLength(N)
    expect(toolCalls.every(item => item.status === 'completed')).toBe(true)
    // Each tool-call row kept its first-seen order (tc-0 .. tc-49) and was folded
    // in place rather than duplicated.
    expect(toolCalls.map(item => item.toolCallId)).toEqual(
      Array.from({ length: N }, (_, i) => `tc-${i}`),
    )
  })

  test('a null stepId and a string-valued stepId never alias in the index', () => {
    // A null stepId and a real stepId string must key distinctly, so a reused
    // toolCallId across the two yields two rows rather than folding into one.
    const frames: AttachFrame[] = [
      { type: 'event', entry: runEvent(1, null, toolCall('tc-1', 'completed', 'Read a')) as any },
      { type: 'event', entry: runEvent(2, '\0', toolCall('tc-1', 'completed', 'Read b')) as any },
    ]
    const vm = reduce(frames)
    const toolCalls = vm.transcript.filter(item => item.kind === 'tool_call')
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0].stepId).toBeNull()
    expect(toolCalls[1].stepId).toBe('\0')
  })

  test('backlog replay (sorted) converges to the same final view as live application', () => {
    const events = [
      runEvent(1, 'step-1', toolCall('tc-1', 'pending', 'Bash: a')),
      runEvent(2, 'step-1', toolCall('tc-1', 'in_progress', 'Bash: a')),
      runEvent(3, 'step-1', toolCall('tc-1', 'completed', 'Bash: a')),
    ]
    // Live: one event frame at a time.
    const live = reduce(events.map(e => ({ type: 'event', entry: e as any })))
    // Backlog: a single (deliberately out-of-order) backlog frame.
    const backlog = reduceFrame(initialViewModel, {
      type: 'backlog',
      entries: [events[2], events[0], events[1]] as any,
      truncated: false,
    })
    expect(backlog.transcript).toEqual(live.transcript)
    expect(backlog.transcript).toHaveLength(1)
    expect(backlog.transcript[0].status).toBe('completed')
    expect(backlog.transcript[0].seqStart).toBe(1)
    expect(backlog.transcript[0].seqEnd).toBe(3)
  })
})

describe('unknown / malformed events', () => {
  test('event with unknown type is silently ignored', () => {
    const vm = reduceFrame(initialViewModel, {
      type: 'event',
      entry: runEvent(1, null, { type: 'unsupported_future_event', data: 123 }) as any,
    })
    expect(vm.transcript).toHaveLength(0)
    expect(vm).toMatchObject(initialViewModel)
  })

  test('reducer is pure — does not mutate input', () => {
    const base = { ...initialViewModel }
    const baseTranscriptRef = base.transcript
    reduceFrame(base, { type: 'status', status: 'completed' })
    expect(base.transcript).toBe(baseTranscriptRef)
    expect(base.status).toBeNull()
  })
})
