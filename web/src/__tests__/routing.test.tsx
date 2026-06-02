import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup'
import { routeTree } from '../router'
import { useCwdStore } from '@/stores/cwd-store'

const BASE = 'http://127.0.0.1:4517'

// ─── FakeWebSocket ─────────────────────────────────────────────────────────────

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  url: string
  private listeners: Record<string, ((event: unknown) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: unknown) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }

  send(_data: string) {}

  close() {
    this.readyState = FakeWebSocket.CLOSED
    for (const cb of this.listeners['close'] ?? []) cb({})
  }

  receive(data: unknown) {
    const event = { data: JSON.stringify(data) }
    for (const cb of this.listeners['message'] ?? []) cb(event)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function renderApp(initialPath = '/', qc?: QueryClient) {
  const queryClient = qc ?? makeQueryClient()
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const testRouter = createRouter({ routeTree, history })
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={testRouter} />
      </QueryClientProvider>,
    ),
    queryClient,
    testRouter,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Unit: route rendering ────────────────────────────────────────────────────

describe('route rendering', () => {
  test('navigating to /runs/abc renders RunView with runId="abc"', async () => {
    renderApp('/runs/abc')

    expect(await screen.findByTestId('run-view')).toBeInTheDocument()
    // WebSocket URL must reference the correct run id
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0)
    })
    expect(FakeWebSocket.instances[0].url).toContain('/runs/abc/attach')
  })

  test('/ renders RunsTable dashboard', async () => {
    renderApp('/')
    // No active cwd → RunsTable no-cwd-state (no HTTP needed)
    expect(await screen.findByTestId('no-cwd-state')).toBeInTheDocument()
  })

  test('/start renders StartRunForm', async () => {
    // No active cwd → shows no-cwd-prompt; form itself is gated on active cwd
    renderApp('/start')
    expect(await screen.findByTestId('no-cwd-prompt')).toBeInTheDocument()
  })

  test('unknown path renders not-found state', async () => {
    renderApp('/this-does-not-exist-at-all')
    expect(await screen.findByTestId('not-found')).toBeInTheDocument()
  })
})

// ─── Unit: socket lifecycle ───────────────────────────────────────────────────

describe('socket lifecycle', () => {
  test('navigating away from /runs/$runId calls attach client close()', async () => {
    const user = userEvent.setup()
    renderApp('/runs/abc')

    // Wait for RunView and its WebSocket to open
    await screen.findByTestId('run-view')
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    const ws = FakeWebSocket.instances[0]
    expect(ws.readyState).toBe(FakeWebSocket.OPEN)

    // Navigate away — RunView unmounts, useAttach cleanup calls client.close() → ws.close()
    // No active cwd so dashboard shows no-cwd-state without a GET /runs call
    await user.click(screen.getByRole('link', { name: 'Dashboard' }))
    await screen.findByTestId('no-cwd-state')

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
  })
})

// ─── Integration: app shell persistence ──────────────────────────────────────

describe('app shell persistence', () => {
  test('cwd switcher is visible on the dashboard route', async () => {
    renderApp('/')
    await screen.findByTestId('app-shell')
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('cwd switcher is visible on the start-run route', async () => {
    renderApp('/start')
    await screen.findByTestId('app-shell')
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('cwd switcher is visible on the run view route', async () => {
    renderApp('/runs/xyz')
    await screen.findByTestId('run-view')
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('cwd switcher is functional: adding a cwd reflects immediately', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByTestId('app-shell')

    await user.type(screen.getByLabelText('Label'), 'My Project')
    await user.type(screen.getByLabelText('Path'), '/home/user/project')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('button', { name: 'My Project' })).toBeInTheDocument()
  })
})

// ─── Integration: full operate loop ──────────────────────────────────────────

describe('full operate loop', () => {
  test('dashboard → start → run view', async () => {
    // Prime cwd store with an active cwd
    useCwdStore.setState({
      cwds: [{ id: 'cwd-1', label: 'MyApp', path: '/home/user/myapp' }],
      activeCwdId: 'cwd-1',
    })

    const RUN_ID = 'run-loop-abc'

    server.use(
      http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })),
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'who-is', path: '/home/user/myapp/workflows/who-is.json' }],
        }),
      ),
      http.post(`${BASE}/runs`, () => HttpResponse.json({ runId: RUN_ID })),
    )

    const user = userEvent.setup()
    renderApp('/')

    // Dashboard: empty runs list (active cwd is set)
    expect(await screen.findByTestId('no-runs-state')).toBeInTheDocument()

    // Navigate to /start via the shell nav link
    await user.click(screen.getByRole('link', { name: 'Start Run' }))

    // StartRunForm: wait for workflow picker to load
    const workflowSelect = await screen.findByLabelText('Workflow')
    await user.selectOptions(workflowSelect, '/home/user/myapp/workflows/who-is.json')

    // Submit → POST /runs → navigate to /runs/<runId>
    await user.click(screen.getByRole('button', { name: 'Start run' }))

    // RunView mounts for the new run
    await screen.findByTestId('run-view')

    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    expect(FakeWebSocket.instances[0].url).toContain(`/runs/${RUN_ID}/attach`)
  })
})
