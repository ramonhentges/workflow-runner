import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import { InputBox } from './InputBox'
import { StepProgress } from './StepProgress'
import { RunControls } from './RunControls'
import { RunView } from './RunView'

const BASE = 'http://127.0.0.1:4517'

beforeAll(() => {
  // jsdom does not implement scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function withQueryClient(ui: React.ReactElement, qc?: QueryClient) {
  return render(
    <QueryClientProvider client={qc ?? makeQueryClient()}>{ui}</QueryClientProvider>,
  )
}

// ─── Fake WebSocket ───────────────────────────────────────────────────────────

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.OPEN
  url: string
  sentMessages: string[] = []
  static instances: FakeWebSocket[] = []

  private listeners: Record<string, ((event: unknown) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: unknown) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this._emit('close', {})
  }

  receive(data: unknown) {
    this._emit('message', { data: JSON.stringify(data) })
  }

  triggerError() {
    this._emit('error', {})
    this.close()
  }

  private _emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event)
  }
}

function latestWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!ws) throw new Error('No FakeWebSocket instance')
  return ws
}

// ─── Unit: InputBox ───────────────────────────────────────────────────────────

describe('InputBox — disabled state', () => {
  test('input is disabled when interactiveEnabled is false', () => {
    render(<InputBox enabled={false} onSend={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  test('Send button is disabled when interactiveEnabled is false', () => {
    render(<InputBox enabled={false} onSend={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  test('input is enabled when interactiveEnabled is true', () => {
    render(<InputBox enabled={true} onSend={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
  })
})

describe('InputBox — send behavior', () => {
  test('calls onSend with the typed text and clears input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<InputBox enabled={true} onSend={onSend} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, 'hello world')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('hello world')
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue('')
  })

  test('does not call onSend when input is empty', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<InputBox enabled={true} onSend={onSend} />)
    // Button is disabled when value is empty, so this just asserts no call
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })

  test('trims whitespace and does not send blank messages', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<InputBox enabled={true} onSend={onSend} />)

    const input = screen.getByRole('textbox', { name: 'Message' })
    await user.type(input, '   ')
    // Send button should remain disabled for whitespace-only input
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })
})

// ─── Unit: StepProgress ──────────────────────────────────────────────────────

describe('StepProgress', () => {
  test('renders nothing when steps is empty', () => {
    const { container } = render(<StepProgress steps={[]} />)
    expect(container.firstChild).toBeNull()
  })

  test('renders each step id', () => {
    render(
      <StepProgress
        steps={[
          { id: 'step-1', index: 0, active: false },
          { id: 'step-2', index: 1, active: true },
        ]}
      />,
    )
    expect(screen.getByTestId('step-indicator-step-1')).toBeInTheDocument()
    expect(screen.getByTestId('step-indicator-step-2')).toBeInTheDocument()
  })

  test('active step has data-active=true', () => {
    render(
      <StepProgress
        steps={[
          { id: 'step-a', index: 0, active: false },
          { id: 'step-b', index: 1, active: false },
          { id: 'step-c', index: 2, active: true },
        ]}
      />,
    )
    expect(screen.getByTestId('step-indicator-step-a')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('step-indicator-step-b')).toHaveAttribute('data-active', 'false')
    expect(screen.getByTestId('step-indicator-step-c')).toHaveAttribute('data-active', 'true')
  })

  test('only the last step is active after multiple banner events', () => {
    render(
      <StepProgress
        steps={[
          { id: 'first', index: 0, active: false },
          { id: 'second', index: 1, active: false },
          { id: 'third', index: 2, active: true },
        ]}
      />,
    )
    const activeEls = screen
      .getAllByTestId(/^step-indicator-/)
      .filter(el => el.getAttribute('data-active') === 'true')
    expect(activeEls).toHaveLength(1)
    expect(activeEls[0]).toHaveAttribute('data-testid', 'step-indicator-third')
  })
})

// ─── Unit: RunControls — button availability ──────────────────────────────────

describe('RunControls — Stop button', () => {
  test('enabled for "running" status', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary={null} />)
    expect(screen.getByTestId('stop-button')).not.toBeDisabled()
  })

  test('disabled for "completed" status', () => {
    withQueryClient(<RunControls runId="r1" status="completed" summary={null} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  test('disabled for "failed" status', () => {
    withQueryClient(<RunControls runId="r1" status="failed" summary={null} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  test('disabled for "crashed" status', () => {
    withQueryClient(<RunControls runId="r1" status="crashed" summary={null} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  test('disabled for "aborted" status', () => {
    withQueryClient(<RunControls runId="r1" status="aborted" summary={null} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  test('disabled when status is null', () => {
    withQueryClient(<RunControls runId="r1" status={null} summary={null} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })
})

describe('RunControls — Retry button', () => {
  test('enabled for "failed" status', () => {
    withQueryClient(<RunControls runId="r1" status="failed" summary={null} />)
    expect(screen.getByTestId('retry-button')).not.toBeDisabled()
  })

  test('enabled for "crashed" status', () => {
    withQueryClient(<RunControls runId="r1" status="crashed" summary={null} />)
    expect(screen.getByTestId('retry-button')).not.toBeDisabled()
  })

  test('enabled for "aborted" status', () => {
    withQueryClient(<RunControls runId="r1" status="aborted" summary={null} />)
    expect(screen.getByTestId('retry-button')).not.toBeDisabled()
  })

  test('disabled for "running" status', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary={null} />)
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })

  test('disabled for "completed" status', () => {
    withQueryClient(<RunControls runId="r1" status="completed" summary={null} />)
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })

  test('disabled when status is null', () => {
    withQueryClient(<RunControls runId="r1" status={null} summary={null} />)
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })
})

describe('RunControls — closed prop disables buttons', () => {
  test('Stop is disabled when socket is closed and status is "running"', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary={null} closed={true} />)
    expect(screen.getByTestId('stop-button')).toBeDisabled()
  })

  test('Retry is disabled when socket is closed and status is "failed"', () => {
    withQueryClient(<RunControls runId="r1" status="failed" summary={null} closed={true} />)
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })

  test('Retry is disabled when socket is closed and status is "crashed"', () => {
    withQueryClient(<RunControls runId="r1" status="crashed" summary={null} closed={true} />)
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })

  test('Stop and Retry remain usable when closed is false and status allows it', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary={null} closed={false} />)
    expect(screen.getByTestId('stop-button')).not.toBeDisabled()
  })
})

// ─── Unit: RunControls — summary panel ───────────────────────────────────────

describe('RunControls — summary panel', () => {
  test('renders when status is "completed" and summary is a string', () => {
    withQueryClient(<RunControls runId="r1" status="completed" summary="All done!" />)
    expect(screen.getByTestId('summary-panel')).toBeInTheDocument()
    expect(screen.getByText('All done!')).toBeInTheDocument()
  })

  test('renders when status is "failed" and summary is an object', () => {
    withQueryClient(<RunControls runId="r1" status="failed" summary={{ result: 'err' }} />)
    expect(screen.getByTestId('summary-panel')).toBeInTheDocument()
    expect(screen.getByTestId('summary-panel')).toHaveTextContent('"result": "err"')
  })

  test('renders when status is "crashed" and summary is present', () => {
    withQueryClient(<RunControls runId="r1" status="crashed" summary="crashed summary" />)
    expect(screen.getByTestId('summary-panel')).toBeInTheDocument()
  })

  test('renders when status is "aborted" and summary is present', () => {
    withQueryClient(<RunControls runId="r1" status="aborted" summary="aborted summary" />)
    expect(screen.getByTestId('summary-panel')).toBeInTheDocument()
  })

  test('does not render when status is "running" even with summary', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary="in progress" />)
    expect(screen.queryByTestId('summary-panel')).not.toBeInTheDocument()
  })

  test('does not render when summary is null even with terminal status', () => {
    withQueryClient(<RunControls runId="r1" status="completed" summary={null} />)
    expect(screen.queryByTestId('summary-panel')).not.toBeInTheDocument()
  })

  test('does not render when status is null', () => {
    withQueryClient(<RunControls runId="r1" status={null} summary="something" />)
    expect(screen.queryByTestId('summary-panel')).not.toBeInTheDocument()
  })
})

// ─── Unit: RunControls — status badge + summary Card ─────────────────────────

describe('RunControls — status badge', () => {
  test('renders a StatusBadge for a non-null status', () => {
    withQueryClient(<RunControls runId="r1" status="running" summary={null} />)
    const badge = document.querySelector('[data-slot="badge"][data-status="running"]')
    expect(badge).not.toBeNull()
    expect(badge).toHaveTextContent('Running')
  })

  test('does not render a StatusBadge when status is null', () => {
    withQueryClient(<RunControls runId="r1" status={null} summary={null} />)
    expect(document.querySelector('[data-slot="badge"][data-status]')).toBeNull()
  })
})

describe('RunControls — summary Card', () => {
  test('summary-panel is a shadcn Card', () => {
    withQueryClient(<RunControls runId="r1" status="completed" summary="All done!" />)
    expect(screen.getByTestId('summary-panel')).toHaveAttribute('data-slot', 'card')
  })
})

// ─── Integration: RunView with fake socket ────────────────────────────────────

describe('RunView integration (fake WebSocket + MSW)', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderRunView(runId = 'test-run', qc?: QueryClient) {
    const queryClient = qc ?? makeQueryClient()
    return {
      ...render(
        <QueryClientProvider client={queryClient}>
          <RunView runId={runId} />
        </QueryClientProvider>,
      ),
      queryClient,
    }
  }

  test('renders transcript, input box, and controls on mount', () => {
    renderRunView('run-mount')
    expect(screen.getByTestId('transcript')).toBeInTheDocument()
    expect(screen.getByTestId('input-box')).toBeInTheDocument()
    expect(screen.getByTestId('stop-button')).toBeInTheDocument()
    expect(screen.getByTestId('retry-button')).toBeInTheDocument()
  })

  test('renders worktree path and branch for an isolated run snapshot', async () => {
    renderRunView('run-isolated')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-isolated',
          slug: 'iso-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          worktreePath: '/repo-feature-x',
          branch: 'feature/x',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('isolation-info')).toBeInTheDocument()
    })
    expect(screen.getByTestId('isolation-branch')).toHaveTextContent('feature/x')
    expect(screen.getByTestId('isolation-worktree')).toHaveTextContent('/repo-feature-x')
  })

  test('renders no isolation info for a non-isolated run snapshot', async () => {
    renderRunView('run-plain')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-plain',
          slug: 'plain-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    // Give the snapshot a chance to apply, then assert the panel is absent.
    await waitFor(() => {
      expect(screen.getByTestId('run-view')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('isolation-info')).not.toBeInTheDocument()
  })

  test('renders the initial prompt as the opening transcript message when the snapshot carries initialPrompt', async () => {
    renderRunView('run-prompt')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-prompt',
          slug: 'prompt-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          initialPrompt: 'Ship the launch prompt feature',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    // The prompt now lives inside the chat flow as the leading message (matching
    // the TUI), not in a standalone header banner.
    let items: HTMLElement[] = []
    await waitFor(() => {
      items = screen.getAllByTestId('transcript-item')
      expect(items.length).toBeGreaterThan(0)
    })
    expect(items[0]).toHaveAttribute('data-kind', 'message')
    expect(items[0]).toHaveTextContent('Ship the launch prompt feature')
    expect(screen.queryByTestId('initial-prompt-info')).not.toBeInTheDocument()
  })

  test('shows the prompt as the opening message after a streamed agent reply', async () => {
    renderRunView('run-prompt-stream')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-prompt-stream',
          slug: 'prompt-stream-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          initialPrompt: 'Investigate the regression',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-1',
          event: { type: 'stream', kind: 'text', chunk: 'Looking into it' },
        },
      })
    })

    expect(await screen.findByText('Looking into it')).toBeInTheDocument()
    // The synthetic prompt entry stays at the top, ahead of the agent reply.
    const items = screen.getAllByTestId('transcript-item')
    expect(items[0]).toHaveTextContent('Investigate the regression')
    expect(items[items.length - 1]).toHaveTextContent('Looking into it')
  })

  test('renders the prompt message alongside an unchanged isolation block', async () => {
    renderRunView('run-prompt-iso')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-prompt-iso',
          slug: 'prompt-iso-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          worktreePath: '/repo-feature-x',
          branch: 'feature/x',
          initialPrompt: 'Investigate the bug',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    let items: HTMLElement[] = []
    await waitFor(() => {
      items = screen.getAllByTestId('transcript-item')
      expect(items.length).toBeGreaterThan(0)
    })
    expect(items[0]).toHaveTextContent('Investigate the bug')
    // Isolation display is unchanged and still rendered.
    expect(screen.getByTestId('isolation-branch')).toHaveTextContent('feature/x')
    expect(screen.getByTestId('isolation-worktree')).toHaveTextContent('/repo-feature-x')
  })

  test('does not inject a prompt message when the snapshot has no initialPrompt', async () => {
    renderRunView('run-no-prompt')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-no-prompt',
          slug: 'no-prompt-slug',
          workflowPath: '/tmp/wf.json',
          cwd: '/repo',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('run-view')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('initial-prompt-info')).not.toBeInTheDocument()
    // No snapshot prompt and no events ⇒ no transcript entries at all.
    expect(screen.queryAllByTestId('transcript-item')).toHaveLength(0)
  })

  test('snapshot → stream event → interactive(true) → status(completed) → summary panel', async () => {
    renderRunView('run-seq')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'snapshot',
        snapshot: {
          id: 'run-seq',
          slug: 'seq-slug',
          workflowPath: '/tmp/wf.json',
          status: 'running',
          currentStepId: 'step-1',
          visitedStepIds: [],
          startedAt: 1000,
          endedAt: null,
          attachedCount: 1,
        },
      })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-1',
          event: { type: 'stream', kind: 'text', chunk: 'Hello from agent' },
        },
      })
    })

    expect(await screen.findByText('Hello from agent')).toBeInTheDocument()

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 2,
          ts: 1001,
          stepId: 'step-1',
          event: { type: 'interactive', enabled: true },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
    })

    act(() => {
      ws.receive({ type: 'status', status: 'completed' })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 3,
          ts: 1002,
          stepId: null,
          event: { type: 'summary', summary: 'Run finished successfully.' },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('summary-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('summary-panel')).toHaveTextContent('Run finished successfully.')
    // Transcript still shows the streamed text
    expect(screen.getByText('Hello from agent')).toBeInTheDocument()
  })

  test('banner events update step-progress and transcript', async () => {
    renderRunView('run-banner')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-a',
          event: { type: 'banner', step: { id: 'step-a' }, index: 0 },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('step-progress')).toBeInTheDocument()
    })
    expect(screen.getByTestId('step-indicator-step-a')).toHaveAttribute('data-active', 'true')

    const transcriptItems = screen.getAllByTestId('transcript-item')
    expect(transcriptItems.some(el => el.getAttribute('data-kind') === 'step')).toBe(true)
  })

  test('clicking Stop invokes POST /runs/:id/stop via MSW', async () => {
    const user = userEvent.setup()

    let capturedUrl = ''
    server.use(
      http.post(`${BASE}/runs/run-stop-int/stop`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ finalStatus: 'aborted' })
      }),
    )

    renderRunView('run-stop-int')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'running' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('stop-button')).not.toBeDisabled()
    })

    await user.click(screen.getByTestId('stop-button'))

    await waitFor(() => {
      expect(capturedUrl).toContain('/runs/run-stop-int/stop')
    })
  })

  test('clicking Retry invokes POST /runs/:id/retry-step via MSW', async () => {
    const user = userEvent.setup()

    let capturedUrl = ''
    server.use(
      http.post(`${BASE}/runs/run-retry-int/retry-step`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ resumedStepId: 'step-1' })
      }),
    )

    renderRunView('run-retry-int')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'failed' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).not.toBeDisabled()
    })

    await user.click(screen.getByTestId('retry-button'))

    await waitFor(() => {
      expect(capturedUrl).toContain('/runs/run-retry-int/retry-step')
    })
  })

  test('sending input via InputBox delivers a JSON input frame over the socket', async () => {
    const user = userEvent.setup()
    renderRunView('run-input-int')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'running' })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-1',
          event: { type: 'interactive', enabled: true },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
    })

    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'hello agent')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(
      ws.sentMessages.some(raw => {
        try {
          const msg = JSON.parse(raw) as { type?: string; message?: string }
          return msg.type === 'input' && msg.message === 'hello agent'
        } catch {
          return false
        }
      }),
    ).toBe(true)
  })

  test('server error frame renders a notice without unmounting the transcript', async () => {
    renderRunView('run-err-int')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: null,
          event: { type: 'stream', kind: 'text', chunk: 'Some output before error' },
        },
      })
    })

    expect(await screen.findByText('Some output before error')).toBeInTheDocument()

    act(() => {
      ws.receive({ type: 'error', code: 'OVERFLOW', message: 'Event log overflow' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('socket-error-notice')).toBeInTheDocument()
    })
    const errorNotice = screen.getByTestId('socket-error-notice')
    expect(errorNotice).toHaveAttribute('role', 'alert')
    expect(errorNotice).toHaveAttribute('data-slot', 'alert')
    expect(errorNotice).toHaveTextContent('Event log overflow')
    // Transcript and run-view still mounted
    expect(screen.getByTestId('transcript')).toBeInTheDocument()
    expect(screen.getByText('Some output before error')).toBeInTheDocument()
  })

  test('socket close on a terminal run renders a closed notice without unmounting the transcript', async () => {
    renderRunView('run-close-int')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: null,
          event: { type: 'log', message: 'Log entry before close' },
        },
      })
    })

    expect(await screen.findByText('Log entry before close')).toBeInTheDocument()

    // A terminal status means the server closed normally — no reconnect, so the
    // closed notice surfaces.
    act(() => {
      ws.receive({ type: 'status', status: 'completed' })
    })
    act(() => {
      ws.close()
    })

    await waitFor(() => {
      expect(screen.getByTestId('socket-closed-notice')).toBeInTheDocument()
    })
    const closedNotice = screen.getByTestId('socket-closed-notice')
    expect(closedNotice).toHaveAttribute('role', 'status')
    expect(closedNotice).toHaveAttribute('data-slot', 'alert')
    // Transcript remains in the DOM
    expect(screen.getByTestId('transcript')).toBeInTheDocument()
    expect(screen.getByText('Log entry before close')).toBeInTheDocument()
  })

  test('input stays enabled across a transient socket close (auto-reconnect) on a running interactive run', async () => {
    renderRunView('run-input-close')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'running' })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-1',
          event: { type: 'interactive', enabled: true },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
    })

    // A drop while the run is still running triggers a silent reconnect — the
    // bar must NOT be disabled and no closed notice should appear.
    act(() => {
      ws.close()
    })

    expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
    expect(screen.queryByTestId('socket-closed-notice')).not.toBeInTheDocument()
  })

  test('input is disabled when run reaches terminal status while interactive is enabled', async () => {
    renderRunView('run-input-terminal')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'running' })
    })

    act(() => {
      ws.receive({
        type: 'event',
        entry: {
          seq: 1,
          ts: 1000,
          stepId: 'step-1',
          event: { type: 'interactive', enabled: true },
        },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' })).not.toBeDisabled()
    })

    act(() => {
      ws.receive({ type: 'status', status: 'completed' })
    })

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    })
  })

  test('WebSocket error event on a terminal run triggers closed notice without crashing', async () => {
    renderRunView('run-wserr-int')
    const ws = latestWs()

    // Terminal status → the error/close is final (no reconnect) and surfaces the
    // closed notice.
    act(() => {
      ws.receive({ type: 'status', status: 'completed' })
    })
    act(() => {
      ws.triggerError()
    })

    await waitFor(() => {
      expect(screen.getByTestId('socket-closed-notice')).toBeInTheDocument()
    })
    expect(screen.getByTestId('run-view')).toBeInTheDocument()
  })

  test('Stop and Retry buttons stay enabled across a transient socket close (auto-reconnect) while running', async () => {
    renderRunView('run-controls-close')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'running' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('stop-button')).not.toBeDisabled()
    })

    // A drop while running reconnects silently — controls remain live.
    act(() => {
      ws.close()
    })

    expect(screen.getByTestId('stop-button')).not.toBeDisabled()
    expect(screen.queryByTestId('socket-closed-notice')).not.toBeInTheDocument()
  })

  test('Retry button is disabled when socket closes while status is "failed"', async () => {
    renderRunView('run-controls-close-failed')
    const ws = latestWs()

    act(() => {
      ws.receive({ type: 'status', status: 'failed' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('retry-button')).not.toBeDisabled()
    })

    act(() => {
      ws.close()
    })

    await waitFor(() => {
      expect(screen.getByTestId('socket-closed-notice')).toBeInTheDocument()
    })
    expect(screen.getByTestId('retry-button')).toBeDisabled()
  })

  test('backlog with truncated:true renders truncation notice at top of transcript', async () => {
    renderRunView('run-trunc')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'backlog',
        entries: [
          { seq: 1, ts: 1000, stepId: 'step-1', event: { type: 'log', message: 'partial history' } },
        ],
        truncated: true,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('transcript-truncated-notice')).toBeInTheDocument()
    })
    expect(screen.getByText('partial history')).toBeInTheDocument()
  })

  test('backlog with truncated:false does not render truncation notice', async () => {
    renderRunView('run-no-trunc')
    const ws = latestWs()

    act(() => {
      ws.receive({
        type: 'backlog',
        entries: [
          { seq: 1, ts: 1000, stepId: 'step-1', event: { type: 'log', message: 'full history' } },
        ],
        truncated: false,
      })
    })

    expect(await screen.findByText('full history')).toBeInTheDocument()
    expect(screen.queryByTestId('transcript-truncated-notice')).not.toBeInTheDocument()
  })
})
