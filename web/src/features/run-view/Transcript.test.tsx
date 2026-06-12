import { describe, test, expect, beforeAll, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Transcript } from './Transcript'
import { reduceFrame, initialViewModel } from '@/lib/ws/reducer'
import type { TranscriptItem } from '@/lib/ws/reducer'
import type { AttachFrame } from '@/lib/api/types'

beforeAll(() => {
  // jsdom does not implement scrollIntoView; the transcript calls it on update.
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

function toolCallItem(overrides: Partial<TranscriptItem> = {}): TranscriptItem {
  return {
    kind: 'tool_call',
    stepId: 'step-1',
    text: 'Bash: npm test',
    seqStart: 1,
    seqEnd: 1,
    toolCallId: 'tc-1',
    status: 'pending',
    ...overrides,
  }
}

// Builds reducer-derived transcript items from a sequence of tool_call events so
// integration tests exercise the real fold-by-id path (task_05) end to end.
function toolCallFrame(
  seq: number,
  call: { toolCallId: string; status: string; kind?: string; title: string; errorText?: string },
  stepId = 'step-1',
): AttachFrame {
  return {
    type: 'event',
    entry: {
      seq,
      ts: seq * 1000,
      stepId,
      event: { type: 'tool_call', call: { kind: 'execute', ...call } },
    },
  } as AttachFrame
}

// A step banner frame; the reducer scopes the tool-call fold per step on each
// banner, so this is what makes a re-seen toolCallId land in a fresh row.
function bannerFrame(seq: number, stepId: string, index: number): AttachFrame {
  return {
    type: 'event',
    entry: {
      seq,
      ts: seq * 1000,
      stepId,
      event: { type: 'banner', step: { id: stepId }, index },
    },
  } as AttachFrame
}

// ─── Unit: status affordance per state ───────────────────────────────────────

describe('Transcript — tool_call status affordance', () => {
  test('in_progress renders the spinner and not the completed/failed marks', () => {
    render(<Transcript items={[toolCallItem({ status: 'in_progress' })]} />)
    const spinner = screen.getByTestId('tool-call-spinner')
    expect(spinner).toBeInTheDocument()
    expect(spinner).toHaveClass('animate-spin')
    // No settled terminal mark while running.
    expect(screen.queryByTestId('tool-call-icon')).not.toBeInTheDocument()
  })

  test('completed renders the success mark and the title text', () => {
    render(<Transcript items={[toolCallItem({ status: 'completed', text: 'Bash: npm test' })]} />)
    const icon = screen.getByTestId('tool-call-icon')
    expect(icon).toHaveAttribute('aria-label', 'completed')
    expect(icon).toHaveClass('text-status-completed')
    expect(screen.queryByTestId('tool-call-spinner')).not.toBeInTheDocument()
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument()
  })

  test('failed with errorText renders the failure mark and the error inline', () => {
    render(
      <Transcript
        items={[
          toolCallItem({ status: 'failed', text: 'Edit web/App.tsx', errorText: 'file not found' }),
        ]}
      />,
    )
    const icon = screen.getByTestId('tool-call-icon')
    expect(icon).toHaveAttribute('aria-label', 'failed')
    expect(icon).toHaveClass('text-status-failed')
    const row = screen.getByTestId('transcript-item')
    expect(row).toHaveTextContent('Edit web/App.tsx — file not found')
  })

  test('pending renders the pending affordance', () => {
    render(<Transcript items={[toolCallItem({ status: 'pending' })]} />)
    const icon = screen.getByTestId('tool-call-icon')
    expect(icon).toHaveAttribute('aria-label', 'pending')
    expect(screen.queryByTestId('tool-call-spinner')).not.toBeInTheDocument()
  })

  test('missing status falls back to the pending affordance', () => {
    render(<Transcript items={[toolCallItem({ status: undefined })]} />)
    expect(screen.getByTestId('tool-call-icon')).toHaveAttribute('aria-label', 'pending')
  })
})

describe('Transcript — tool_call row markup', () => {
  test('the row carries data-kind="tool_call" and reflects the status', () => {
    render(<Transcript items={[toolCallItem({ status: 'in_progress' })]} />)
    const row = screen.getByTestId('transcript-item')
    expect(row).toHaveAttribute('data-kind', 'tool_call')
    expect(row).toHaveAttribute('data-status', 'in_progress')
  })

  test('a non-failed row without errorText shows only the title', () => {
    render(<Transcript items={[toolCallItem({ status: 'completed', text: 'Read src/runner.ts' })]} />)
    const row = screen.getByTestId('transcript-item')
    expect(row).toHaveTextContent('Read src/runner.ts')
    expect(row.textContent).not.toContain('—')
  })

  test('renders alongside other transcript kinds without interference', () => {
    const items: TranscriptItem[] = [
      { kind: 'step', stepId: 'step-1', text: 'step-1', seqStart: 1, seqEnd: 1 },
      toolCallItem({ status: 'completed', seqStart: 2, seqEnd: 2 }),
    ]
    render(<Transcript items={items} />)
    const rows = screen.getAllByTestId('transcript-item')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-kind', 'step')
    expect(rows[1]).toHaveAttribute('data-kind', 'tool_call')
  })
})

// ─── Message rendering: markdown via Streamdown ──────────────────────────────

describe('Transcript — message markdown rendering', () => {
  function messageItem(text: string): TranscriptItem {
    return { kind: 'message', stepId: 'step-1', text, seqStart: 1, seqEnd: 1 }
  }

  test('renders markdown structure (heading, list, inline code) for message items', () => {
    render(<Transcript items={[messageItem('# Title\n\n- a\n- b\n\n`code`')]} />)
    const row = screen.getByTestId('transcript-item')
    expect(row).toHaveAttribute('data-kind', 'message')
    expect(row.querySelector('h1')).toHaveTextContent('Title')
    expect(row.querySelectorAll('li')).toHaveLength(2)
    expect(row.querySelector('code')).toHaveTextContent('code')
  })

  test('plain message text remains findable as a single block', () => {
    render(<Transcript items={[messageItem('Hello from agent')]} />)
    expect(screen.getByText('Hello from agent')).toBeInTheDocument()
  })
})

// ─── Integration: live transitions + finished-run replay via the reducer ─────

describe('Transcript — tool_call live transitions (keyed by toolCallId)', () => {
  test('re-rendering the same toolCallId from in_progress to completed updates the row in place', () => {
    const running = reduceFrame(
      initialViewModel,
      toolCallFrame(1, { toolCallId: 'tc-1', status: 'in_progress', title: 'Bash: npm test' }),
    )
    const { rerender } = render(<Transcript items={running.transcript} />)
    expect(screen.getByTestId('tool-call-spinner')).toBeInTheDocument()
    const rowBefore = screen.getByTestId('transcript-item')

    const done = reduceFrame(
      running,
      toolCallFrame(2, { toolCallId: 'tc-1', status: 'completed', title: 'Bash: npm test' }),
    )
    rerender(<Transcript items={done.transcript} />)

    // Exactly one row, updated in place (same DOM node preserved by the stable key).
    const rows = screen.getAllByTestId('transcript-item')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toBe(rowBefore)
    expect(screen.queryByTestId('tool-call-spinner')).not.toBeInTheDocument()
    expect(screen.getByTestId('tool-call-icon')).toHaveAttribute('aria-label', 'completed')
  })

  test('a reduced finished-run transcript renders each tool call once in its final state', () => {
    const frames: AttachFrame[] = [
      toolCallFrame(1, { toolCallId: 'tc-1', status: 'pending', title: 'Bash: a' }),
      toolCallFrame(2, { toolCallId: 'tc-2', status: 'pending', title: 'Edit b.ts' }),
      toolCallFrame(3, { toolCallId: 'tc-1', status: 'completed', title: 'Bash: a' }),
      toolCallFrame(4, {
        toolCallId: 'tc-2',
        status: 'failed',
        title: 'Edit b.ts',
        errorText: 'permission denied',
      }),
    ]
    const vm = frames.reduce((acc, f) => reduceFrame(acc, f), initialViewModel)
    render(<Transcript items={vm.transcript} />)

    const rows = screen.getAllByTestId('transcript-item')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAttribute('data-status', 'completed')
    expect(rows[0]).toHaveTextContent('Bash: a')
    expect(rows[1]).toHaveAttribute('data-status', 'failed')
    expect(rows[1]).toHaveTextContent('Edit b.ts — permission denied')
    // Finished run: no spinners remain.
    expect(screen.queryByTestId('tool-call-spinner')).not.toBeInTheDocument()
  })

  test('the same toolCallId re-seen in a new step renders a second row, updated independently', () => {
    // Mirrors reducer.test.ts "a re-seen toolCallId in a new step creates a new
    // row" and the TUI's banner-cleared map: adapters that restart sequential
    // ids per step legitimately reuse `tc-1` across steps. The render key must
    // include stepId so the two rows do not collide on a duplicate React key.
    const frames: AttachFrame[] = [
      bannerFrame(1, 'step-1', 0),
      toolCallFrame(2, { toolCallId: 'tc-1', status: 'completed', title: 'Bash: step-1 work' }, 'step-1'),
      bannerFrame(3, 'step-2', 1),
      toolCallFrame(4, { toolCallId: 'tc-1', status: 'in_progress', title: 'Bash: step-2 work' }, 'step-2'),
    ]
    const vm = frames.reduce((acc, f) => reduceFrame(acc, f), initialViewModel)
    const { rerender } = render(<Transcript items={vm.transcript} />)

    // Two distinct tool-call rows despite the shared toolCallId.
    let toolRows = screen
      .getAllByTestId('transcript-item')
      .filter((row) => row.getAttribute('data-kind') === 'tool_call')
    expect(toolRows).toHaveLength(2)
    expect(toolRows[0]).toHaveAttribute('data-status', 'completed')
    expect(toolRows[0]).toHaveTextContent('Bash: step-1 work')
    expect(toolRows[1]).toHaveAttribute('data-status', 'in_progress')
    expect(toolRows[1]).toHaveTextContent('Bash: step-2 work')
    const step1RowBefore = toolRows[0]
    const step2RowBefore = toolRows[1]

    // Completing the step-2 tc-1 must update only the step-2 row; the unique key
    // keeps each DOM node bound to its own (stepId, toolCallId) identity.
    const done = reduceFrame(
      vm,
      toolCallFrame(5, { toolCallId: 'tc-1', status: 'completed', title: 'Bash: step-2 work' }, 'step-2'),
    )
    rerender(<Transcript items={done.transcript} />)

    toolRows = screen
      .getAllByTestId('transcript-item')
      .filter((row) => row.getAttribute('data-kind') === 'tool_call')
    expect(toolRows).toHaveLength(2)
    // Same DOM nodes preserved — reconciliation tracked each row by its key.
    expect(toolRows[0]).toBe(step1RowBefore)
    expect(toolRows[1]).toBe(step2RowBefore)
    expect(toolRows[0]).toHaveAttribute('data-status', 'completed')
    expect(toolRows[1]).toHaveAttribute('data-status', 'completed')
    expect(screen.queryByTestId('tool-call-spinner')).not.toBeInTheDocument()
  })
})
