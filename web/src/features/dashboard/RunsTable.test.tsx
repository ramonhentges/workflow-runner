import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RouterProvider,
  createRouter,
  createRootRoute,
  createRoute,
  Outlet,
  createMemoryHistory,
} from '@tanstack/react-router'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { RunsTable } from './RunsTable'
import { parseStatus, type RunStatus, type RunSummary } from '@/lib/api/types'

const BASE = 'http://127.0.0.1:4517'

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    slug: 'abc-def',
    workflowPath: '/tmp/workflows/wf.json',
    currentStepId: null,
    status: 'running',
    startedAt: 1_000_000,
    endedAt: null,
    attachedCount: 0,
    ...overrides,
  }
}

function renderWithRouter(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    validateSearch: (search: Record<string, unknown>): { status?: RunStatus } => ({
      status: parseStatus(search.status),
    }),
    component: RunsTable,
  })
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: () => <div data-testid="run-view-page" />,
  })
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: () => <div data-testid="start-run-page" />,
  })
  const testRouteTree = rootRoute.addChildren([indexRoute, runsRoute, startRoute])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const testRouter = createRouter({ routeTree: testRouteTree, history })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
})

// Unit tests — state identifiers

describe('RunsTable — state identifiers', () => {
  test('shows no-cwd empty state when there is no active cwd', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    expect(await screen.findByTestId('no-cwd-state')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('shows an action-oriented no-runs empty state linking to /start', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    const empty = await screen.findByTestId('no-runs-state')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const action = within(empty).getByTestId('start-run-action')
    expect(action).toHaveAttribute('href', '/start')
  })

  test('renders skeleton rows (not plain text) while the runs request is in flight', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/runs`, async () => {
        await delay('infinite')
        return HttpResponse.json({ runs: [] })
      }),
    )

    renderWithRouter()

    const loading = await screen.findByTestId('loading-state')
    expect(within(loading).getAllByTestId('run-row-skeleton').length).toBeGreaterThan(0)
    expect(within(loading).queryByText(/loading/i)).not.toBeInTheDocument()
  })

  test('renders skeleton status cards while the first runs request is in flight', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/runs`, async () => {
        await delay('infinite')
        return HttpResponse.json({ runs: [] })
      }),
    )

    renderWithRouter()

    expect(await screen.findByTestId('status-cards-skeleton')).toBeInTheDocument()
    expect(screen.queryByTestId('status-summary-cards')).not.toBeInTheDocument()
  })

  test('shows error state when the runs request fails', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({}, { status: 500 })))

    renderWithRouter()

    expect(await screen.findByTestId('error-state')).toBeInTheDocument()
  })
})

// Unit tests — table structure

describe('RunsTable — table structure', () => {
  test('renders a table with headers in order status → workflow → current step → started → duration', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [makeRunSummary()] })),
    )

    renderWithRouter()

    await screen.findByTestId('run-row-run-1')
    expect(screen.getByRole('table')).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map(h => h.textContent)
    expect(headers).toEqual(['Status', 'Workflow', 'Current step', 'Started', 'Duration'])
  })

  test('applies distinct data-status for each run status', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const runs: RunSummary[] = [
      makeRunSummary({ id: 'r-run', slug: 's1', status: 'running' }),
      makeRunSummary({ id: 'r-fail', slug: 's2', status: 'failed' }),
      makeRunSummary({ id: 'r-done', slug: 's3', status: 'completed' }),
      makeRunSummary({ id: 'r-crash', slug: 's4', status: 'crashed' }),
      makeRunSummary({ id: 'r-abort', slug: 's5', status: 'aborted' }),
    ]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs })))

    renderWithRouter()

    await screen.findByTestId('run-row-r-run')
    expect(screen.getByTestId('run-row-r-run')).toHaveAttribute('data-status', 'running')
    expect(screen.getByTestId('run-row-r-fail')).toHaveAttribute('data-status', 'failed')
    expect(screen.getByTestId('run-row-r-done')).toHaveAttribute('data-status', 'completed')
    expect(screen.getByTestId('run-row-r-crash')).toHaveAttribute('data-status', 'crashed')
    expect(screen.getByTestId('run-row-r-abort')).toHaveAttribute('data-status', 'aborted')
  })

  test('status cell renders a StatusBadge, not a raw status-text span', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/runs`, () =>
        HttpResponse.json({ runs: [makeRunSummary({ id: 'run-1', status: 'failed' })] }),
      ),
    )

    renderWithRouter()

    const row = await screen.findByTestId('run-row-run-1')
    const badge = row.querySelector('[data-slot="badge"][data-status="failed"]')
    expect(badge).not.toBeNull()
    // icon-only badge is named for AT but renders no visible raw status string
    expect(within(row).getByLabelText('Failed')).toBe(badge)
    expect(within(row).queryByText('failed')).not.toBeInTheDocument()
  })

  test('renders duration from startedAt/endedAt for a completed run', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const run = makeRunSummary({
      id: 'run-done',
      status: 'completed',
      startedAt: 1_000_000,
      endedAt: 1_090_000, // +90s
    })
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [run] })))

    renderWithRouter()

    const row = await screen.findByTestId('run-row-run-done')
    expect(within(row).getByText('1m 30s')).toBeInTheDocument()
  })

  test('renders — for an unfinished run with no endedAt', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const run = makeRunSummary({ id: 'run-live', status: 'running', endedAt: null })
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [run] })))

    renderWithRouter()

    const row = await screen.findByTestId('run-row-run-live')
    // both the (null) current step and the (unfinished) duration render as —
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(1)
  })
})

// Integration tests

describe('RunsTable — data rendering (integration)', () => {
  test('renders one badge-bearing row per run with workflow name and current step', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const runs: RunSummary[] = [
      makeRunSummary({
        id: 'run-1',
        slug: 'aaa-bbb',
        workflowPath: '/p/workflows/wf1.json',
        status: 'running',
        currentStepId: 'step-1',
      }),
      makeRunSummary({
        id: 'run-2',
        slug: 'ccc-ddd',
        workflowPath: '/p/workflows/wf2.json',
        status: 'completed',
        currentStepId: null,
      }),
    ]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs })))

    renderWithRouter()

    const row1 = await screen.findByTestId('run-row-run-1')
    const row2 = screen.getByTestId('run-row-run-2')
    expect(screen.getByText('aaa-bbb')).toBeInTheDocument()
    expect(screen.getByText('ccc-ddd')).toBeInTheDocument()
    expect(screen.getByText('wf1.json')).toBeInTheDocument()
    expect(screen.getByText('wf2.json')).toBeInTheDocument()
    expect(screen.getByText('step-1')).toBeInTheDocument()
    expect(within(row1).getByLabelText('Running')).toBeInTheDocument()
    expect(within(row2).getByLabelText('Completed')).toBeInTheDocument()
  })
})

describe('RunsTable — navigation (integration)', () => {
  test('clicking a row link navigates to /runs/<id>', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const run = makeRunSummary({ id: 'run-nav', slug: 'nav-slug', status: 'running' })
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [run] })))

    renderWithRouter()

    const link = await screen.findByRole('link', { name: 'nav-slug' })
    await user.click(link)

    expect(await screen.findByTestId('run-view-page')).toBeInTheDocument()
  })
})

describe('RunsTable — empty-state action (integration)', () => {
  test('clicking the start-run action navigates to the start-run route', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    const empty = await screen.findByTestId('no-runs-state')
    await user.click(within(empty).getByTestId('start-run-action'))

    expect(await screen.findByTestId('start-run-page')).toBeInTheDocument()
  })
})

describe('RunsTable — skeleton to loaded (integration)', () => {
  test('transitions from skeleton rows to populated rows once the query resolves', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    server.use(
      http.get(`${BASE}/runs`, async () => {
        await gate
        return HttpResponse.json({ runs: [makeRunSummary({ id: 'run-1', slug: 'after-load' })] })
      }),
    )

    renderWithRouter()

    // Loading first: skeleton rows, no table.
    const loading = await screen.findByTestId('loading-state')
    expect(within(loading).getAllByTestId('run-row-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    // Resolve the query → populated rows replace the skeletons.
    release()
    await screen.findByTestId('run-row-run-1')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('loading-state')).not.toBeInTheDocument()
    expect(screen.queryByTestId('run-row-skeleton')).not.toBeInTheDocument()
  })
})

describe('RunsTable — all runs toggle (integration)', () => {
  test('all runs toggle sends all=true in the request URL after click', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    const capturedUrls: string[] = []
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrls.push(request.url)
        return HttpResponse.json({ runs: [] })
      }),
    )

    renderWithRouter()

    await screen.findByTestId('no-runs-state')

    await user.click(screen.getByRole('button', { name: 'All runs' }))

    await waitFor(() => {
      expect(
        capturedUrls.some(url => new URL(url).searchParams.get('all') === 'true'),
      ).toBe(true)
    })
  })

  test('toggle button flips aria-pressed when active', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    await screen.findByTestId('no-runs-state')
    const btn = screen.getByRole('button', { name: 'All runs' })
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await user.click(btn)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  test('status card counts track the all-runs dataset so they match the rows', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    // The daemon returns more (older terminal) failed runs when all=true; the cards
    // must recount from the same dataset the table renders, not the default scope.
    const defaultRuns = [makeRunSummary({ id: 'fail-recent', status: 'failed' })]
    const allRuns = [
      makeRunSummary({ id: 'fail-recent', status: 'failed' }),
      makeRunSummary({ id: 'fail-old-1', status: 'failed' }),
      makeRunSummary({ id: 'fail-old-2', status: 'failed' }),
    ]
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        const all = new URL(request.url).searchParams.get('all') === 'true'
        return HttpResponse.json({ runs: all ? allRuns : defaultRuns })
      }),
    )

    renderWithRouter()

    // Default scope: the Failed card counts 1 and one failed row is shown.
    await within(await screen.findByTestId('status-card-failed')).findByText('1')

    // Enable "All runs": the card recounts to 3, matching the now-3 rendered rows.
    // Re-query the card each tick — switching the `all` scope briefly remounts the
    // cards through their loading skeleton, so the earlier node reference goes stale.
    await user.click(screen.getByRole('button', { name: 'All runs' }))
    await waitFor(() =>
      expect(within(screen.getByTestId('status-card-failed')).getByText('3')).toBeInTheDocument(),
    )
    await waitFor(() => expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(3))
  })
})

// Status filter (cards → URL → filtered rows)

describe('RunsTable — status filter (integration)', () => {
  const MIXED: RunSummary[] = [
    makeRunSummary({ id: 'r-run', slug: 's-run', status: 'running' }),
    makeRunSummary({ id: 'r-fail1', slug: 's-fail1', status: 'failed' }),
    makeRunSummary({ id: 'r-fail2', slug: 's-fail2', status: 'failed' }),
    makeRunSummary({ id: 'r-done', slug: 's-done', status: 'completed' }),
  ]

  test('renders all rows when no status param is set', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    renderWithRouter()

    await screen.findByTestId('run-row-r-run')
    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(4)
  })

  test('?status=failed filters the rendered rows to failed runs only', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    renderWithRouter('/?status=failed')

    await screen.findByTestId('run-row-r-fail1')
    const rows = screen.getAllByTestId(/^run-row-/)
    expect(rows).toHaveLength(2)
    expect(screen.getByTestId('run-row-r-fail2')).toBeInTheDocument()
    expect(screen.queryByTestId('run-row-r-run')).not.toBeInTheDocument()
    expect(screen.queryByTestId('run-row-r-done')).not.toBeInTheDocument()
  })

  test('clicking the Failed card filters rows, then clearing restores all rows', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    renderWithRouter()

    await screen.findByTestId('run-row-r-run')
    expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(4)

    // Click the Failed summary card → list filters to failed runs only.
    await user.click(screen.getByTestId('status-card-failed'))
    await waitFor(() =>
      expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(2),
    )
    expect(screen.queryByTestId('run-row-r-run')).not.toBeInTheDocument()

    // Click the active Failed card again → filter clears, all rows return.
    await user.click(screen.getByTestId('status-card-failed'))
    await waitFor(() =>
      expect(screen.getAllByTestId(/^run-row-/)).toHaveLength(4),
    )
  })

  test('shows the filtered-empty state when a filter matches no runs', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const noFailures = [makeRunSummary({ id: 'r-run', status: 'running' })]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: noFailures })))

    renderWithRouter('/?status=failed')

    expect(await screen.findByTestId('no-filtered-runs-state')).toBeInTheDocument()
    expect(screen.queryByTestId('run-row-r-run')).not.toBeInTheDocument()
  })
})
