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
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { StatusSummaryCards } from './StatusSummaryCards'
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

function renderCards(initialPath = '/', props: { all?: boolean } = {}) {
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
    component: () => <StatusSummaryCards {...props} />,
  })
  const testRouteTree = rootRoute.addChildren([indexRoute])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const testRouter = createRouter({ routeTree: testRouteTree, history })

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider>,
  )

  return { testRouter }
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  useCwdStore.getState().addCwd('proj', '/p')
})

const MIXED: RunSummary[] = [
  makeRunSummary({ id: 'a', status: 'running' }),
  makeRunSummary({ id: 'b', status: 'running' }),
  makeRunSummary({ id: 'c', status: 'completed' }),
  makeRunSummary({ id: 'd', status: 'failed' }),
  makeRunSummary({ id: 'e', status: 'failed' }),
  makeRunSummary({ id: 'f', status: 'failed' }),
  makeRunSummary({ id: 'g', status: 'crashed' }),
  makeRunSummary({ id: 'h', status: 'aborted' }),
]

describe('StatusSummaryCards — counts', () => {
  test('renders one card per status with counts matching the runs array', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    renderCards()

    const expected: Record<RunStatus, string> = {
      running: '2',
      completed: '1',
      failed: '3',
      crashed: '1',
      aborted: '1',
    }
    // Cards render zeros first, then re-render once the poll resolves; await the data.
    await within(await screen.findByTestId('status-card-running')).findByText('2')
    for (const [status, count] of Object.entries(expected)) {
      const card = screen.getByTestId(`status-card-${status}`)
      expect(within(card).getByText(count)).toBeInTheDocument()
    }
  })

  test('renders zero counts (layout stability) when there are no runs', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })))

    renderCards()

    for (const status of ['running', 'completed', 'failed', 'crashed', 'aborted']) {
      const card = await screen.findByTestId(`status-card-${status}`)
      expect(within(card).getByText('0')).toBeInTheDocument()
    }
  })
})

describe('StatusSummaryCards — failed emphasis', () => {
  test('emphasizes the Failed card when its count is > 0', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    renderCards()

    const failedCard = await screen.findByTestId('status-card-failed')
    await waitFor(() =>
      expect(failedCard).toHaveAttribute('data-emphasized', 'true'),
    )
  })

  test('does not emphasize the Failed card when its count is 0', async () => {
    const noFailures = [makeRunSummary({ id: 'a', status: 'running' })]
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: noFailures })))

    renderCards()

    const failedCard = await screen.findByTestId('status-card-failed')
    // count resolves to 0 → no emphasis
    await waitFor(() => expect(within(failedCard).getByText('0')).toBeInTheDocument())
    expect(failedCard).toHaveAttribute('data-emphasized', 'false')
  })
})

describe('StatusSummaryCards — navigation', () => {
  test('clicking the Failed card navigates to ?status=failed', async () => {
    const user = userEvent.setup()
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    const { testRouter } = renderCards()

    await user.click(await screen.findByTestId('status-card-failed'))

    await waitFor(() =>
      expect(testRouter.state.location.search).toEqual({ status: 'failed' }),
    )
  })

  test('clicking the already-active card clears the status param', async () => {
    const user = userEvent.setup()
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    const { testRouter } = renderCards('/?status=failed')

    const failedCard = await screen.findByTestId('status-card-failed')
    expect(failedCard).toHaveAttribute('aria-pressed', 'true')

    await user.click(failedCard)

    await waitFor(() =>
      expect(testRouter.state.location.search).toEqual({ status: undefined }),
    )
  })

  test('validateSearch coerces an unknown status value to no filter', async () => {
    server.use(http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: MIXED })))

    const { testRouter } = renderCards('/?status=bogus')

    // unknown value is dropped by validateSearch → no card is active
    const failedCard = await screen.findByTestId('status-card-failed')
    expect(failedCard).toHaveAttribute('aria-pressed', 'false')
    expect(testRouter.state.location.search).toEqual({ status: undefined })
  })
})

describe('StatusSummaryCards — all scope', () => {
  test('forwards all=true to the runs query when the all prop is set', async () => {
    const capturedUrls: string[] = []
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrls.push(request.url)
        return HttpResponse.json({ runs: MIXED })
      }),
    )

    renderCards('/', { all: true })

    // The cards must share the table's `all` scope so both derive from one dataset.
    await waitFor(() =>
      expect(
        capturedUrls.some(url => new URL(url).searchParams.get('all') === 'true'),
      ).toBe(true),
    )
  })

  test('omits all from the runs query by default (no all prop)', async () => {
    const capturedUrls: string[] = []
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrls.push(request.url)
        return HttpResponse.json({ runs: MIXED })
      }),
    )

    renderCards()

    await within(await screen.findByTestId('status-card-running')).findByText('2')
    expect(
      capturedUrls.every(url => new URL(url).searchParams.get('all') !== 'true'),
    ).toBe(true)
  })
})
