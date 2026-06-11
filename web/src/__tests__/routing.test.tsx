import { describe, test, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup'
import { routeTree } from '../router'
import { useCwdStore } from '@/stores/cwd-store'
import { ThemeProvider } from '@/components/theme-provider'

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
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={testRouter} />
        </QueryClientProvider>
      </ThemeProvider>,
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

  test('/workflows renders WorkflowList', async () => {
    renderApp('/workflows')
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

  test('cwd switcher is visible on the workflows route', async () => {
    renderApp('/workflows')
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

    const [manageTrigger] = screen.getAllByRole('button', {
      name: 'Manage working directories',
    })
    await user.click(manageTrigger)
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Label'), 'My Project')
    await user.type(within(dialog).getByLabelText('Path'), '/home/user/project')
    await user.click(within(dialog).getByRole('button', { name: 'Add' }))

    // The new directory appears in the dialog list and becomes the active cwd.
    expect(await within(dialog).findByText('My Project')).toBeInTheDocument()
    const state = useCwdStore.getState()
    expect(state.cwds).toHaveLength(1)
    expect(state.activeCwdId).toBe(state.cwds[0].id)
  })
})

// ─── Integration: index route status search param ────────────────────────────

describe('index route status filter', () => {
  beforeEach(() => {
    useCwdStore.setState({
      cwds: [{ id: 'cwd-1', label: 'MyApp', path: '/home/user/myapp' }],
      activeCwdId: 'cwd-1',
    })
    server.use(
      http.get(`${BASE}/runs`, () =>
        HttpResponse.json({
          runs: [
            {
              id: 'r-run',
              slug: 's-run',
              workflowPath: '/p/wf.json',
              currentStepId: null,
              status: 'running',
              startedAt: 1_000_000,
              endedAt: null,
              attachedCount: 0,
            },
            {
              id: 'r-fail',
              slug: 's-fail',
              workflowPath: '/p/wf.json',
              currentStepId: null,
              status: 'failed',
              startedAt: 1_000_000,
              endedAt: 1_001_000,
              attachedCount: 0,
            },
          ],
        }),
      ),
    )
  })

  test('?status=failed filters the dashboard to failed runs', async () => {
    renderApp('/?status=failed')

    await screen.findByTestId('run-row-r-fail')
    expect(screen.queryByTestId('run-row-r-run')).not.toBeInTheDocument()
  })

  test('?status=bogus is coerced to no filter (all runs shown)', async () => {
    renderApp('/?status=bogus')

    await screen.findByTestId('run-row-r-run')
    expect(screen.getByTestId('run-row-r-fail')).toBeInTheDocument()
  })
})

// ─── Integration: new workflow route scope (duplicate seeding) ───────────────

describe('new workflow route duplicate seeding', () => {
  beforeEach(() => {
    useCwdStore.setState({
      cwds: [{ id: 'cwd-1', label: 'MyApp', path: '/home/user/myapp' }],
      activeCwdId: 'cwd-1',
    })
  })

  test('duplicating a global workflow reads the source with scope=global', async () => {
    let capturedScope: string | null = null
    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request, params }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({
          name: String(params.name),
          path: `/global/workflows/${String(params.name)}.json`,
          workflow: { id: 'shared', name: 'Shared', version: '1.0', steps: [] },
        })
      }),
    )

    renderApp('/workflows/new?from=shared&scope=global')

    await waitFor(() => expect(capturedScope).toBe('global'))
  })

  test('a plain create (no scope) defaults the source read to scope=project', async () => {
    let capturedScope: string | null = null
    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request, params }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({
          name: String(params.name),
          path: `/home/user/myapp/workflows/${String(params.name)}.json`,
          workflow: { id: 'alpha', name: 'Alpha', version: '1.0', steps: [] },
        })
      }),
    )

    renderApp('/workflows/new?from=alpha')

    await waitFor(() => expect(capturedScope).toBe('project'))
  })

  test('duplicating a global workflow pre-selects the Global scope toggle', async () => {
    server.use(
      http.get(`${BASE}/workflows/:name`, ({ params }) =>
        HttpResponse.json({
          name: String(params.name),
          path: `/state/workflow-runner/workflows/${String(params.name)}.json`,
          scope: 'global',
          workflow: { id: 'shared', name: 'Shared', version: '1.0', steps: [] },
        }),
      ),
    )

    renderApp('/workflows/new?from=shared&scope=global')

    // Create editor opens with the toggle seeded from the source scope.
    const globalToggle = await screen.findByTestId('scope-toggle-global')
    expect(globalToggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('scope-toggle-project')).toHaveAttribute('aria-pressed', 'false')
  })

  test('a plain create (no scope) keeps the Project scope toggle selected', async () => {
    renderApp('/workflows/new')

    const projectToggle = await screen.findByTestId('scope-toggle-project')
    expect(projectToggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('scope-toggle-global')).toHaveAttribute('aria-pressed', 'false')
  })

  test('a failed source read surfaces an error state instead of a blank editor', async () => {
    server.use(
      http.get(`${BASE}/workflows/:name`, () =>
        HttpResponse.json({ error: { code: 'INTERNAL' } }, { status: 500 }),
      ),
    )

    renderApp('/workflows/new?from=gone&scope=global')

    // Error branch renders with a link back to /workflows; the blank create
    // editor must not appear.
    expect(await screen.findByTestId('workflow-duplicate-error')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to workflows' })).toHaveAttribute(
      'href',
      '/workflows',
    )
    expect(screen.queryByTestId('workflow-editor-form')).not.toBeInTheDocument()
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
          workflows: [
            { name: 'who-is', path: '/home/user/myapp/workflows/who-is.json', scope: 'project' },
          ],
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

    // StartRunForm: wait for the shadcn Select trigger, open it, pick the option
    const workflowSelect = await screen.findByRole('combobox', { name: 'Workflow' })
    await user.click(workflowSelect)
    await user.click(await screen.findByRole('option', { name: /who-is/ }))

    // Submit → POST /runs → navigate to /runs/<runId>
    await user.click(screen.getByRole('button', { name: 'Start run' }))

    // RunView mounts for the new run
    await screen.findByTestId('run-view')

    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0))
    expect(FakeWebSocket.instances[0].url).toContain(`/runs/${RUN_ID}/attach`)
  })
})
