import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { RunsTable } from './RunsTable'
import type { RunSummary } from '@/lib/api/types'

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
    component: RunsTable,
  })
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: () => <div data-testid="run-view-page" />,
  })
  const testRouteTree = rootRoute.addChildren([indexRoute, runsRoute])
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

// Unit tests

describe('RunsTable — empty states', () => {
  test('shows no-cwd empty state when there is no active cwd', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    expect(await screen.findByTestId('no-cwd-state')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('shows no-runs empty state when /runs returns an empty array', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderWithRouter()

    expect(await screen.findByTestId('no-runs-state')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('RunsTable — status styling', () => {
  test('applies distinct data-status for running, failed, and completed rows', async () => {
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
})

// Integration tests

describe('RunsTable — data rendering (integration)', () => {
  test('renders two rows with workflow name, status, and current step from MSW', async () => {
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

    expect(await screen.findByTestId('run-row-run-1')).toBeInTheDocument()
    expect(screen.getByTestId('run-row-run-2')).toBeInTheDocument()
    expect(screen.getByText('aaa-bbb')).toBeInTheDocument()
    expect(screen.getByText('ccc-ddd')).toBeInTheDocument()
    expect(screen.getByText('wf1.json')).toBeInTheDocument()
    expect(screen.getByText('wf2.json')).toBeInTheDocument()
    expect(screen.getByText('step-1')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText('completed')).toBeInTheDocument()
  })

  test('shows — for ended time when endedAt is null', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const runs = [makeRunSummary({ endedAt: null })]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs })))

    renderWithRouter()

    await screen.findByTestId('run-row-run-1')
    const dashes = screen.getAllByText('—')
    // Both currentStepId null and endedAt null produce '—'
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  test('shows attachedCount in the table row', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const runs = [makeRunSummary({ attachedCount: 3 })]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs })))

    renderWithRouter()

    await screen.findByTestId('run-row-run-1')
    expect(screen.getByText('3')).toBeInTheDocument()
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

  test('toggle button has aria-pressed=true when active', async () => {
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
})
