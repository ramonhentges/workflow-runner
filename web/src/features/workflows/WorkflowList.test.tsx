import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, renderHook, within } from '@testing-library/react'
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
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { WorkflowList } from './WorkflowList'
import { useWorkflowList } from './useWorkflowList'
import type { WorkflowItem } from '@/lib/api/types'

const BASE = 'http://127.0.0.1:4517'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function makeHookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderWorkflowList(initialPath = '/workflows', queryClient = makeQueryClient()) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const workflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workflows',
    component: WorkflowList,
  })
  const newWorkflowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workflows/new',
    component: () => <div data-testid="new-workflow-page" />,
  })
  const editWorkflowRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workflows/$name/edit',
    component: () => <div data-testid="edit-workflow-page" />,
  })
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: () => <div data-testid="run-page" />,
  })
  const routeTree = rootRoute.addChildren([
    workflowsRoute,
    newWorkflowRoute,
    editWorkflowRoute,
    runRoute,
  ])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    queryClient,
    router,
  }
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
})

describe('useWorkflowList', () => {
  test('fetches /workflows with the active cwd', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedUrl = ''
    server.use(
      http.get(`${BASE}/workflows`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(() => useWorkflowList(), {
      wrapper: makeHookWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(new URL(capturedUrl).searchParams.get('cwd')).toBe('/projects/myapp')
  })

  test('does not fetch without an active cwd', async () => {
    let fetched = false
    server.use(
      http.get(`${BASE}/workflows`, () => {
        fetched = true
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(() => useWorkflowList(), {
      wrapper: makeHookWrapper(queryClient),
    })

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('WorkflowList rendering', () => {
  test('renders workflow rows from the list response', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'alpha-flow.json', path: '/p/workflows/alpha-flow.json' },
            { name: 'beta.json', path: '/p/workflows/beta.json' },
          ],
        }),
      ),
    )

    renderWorkflowList()

    expect(await screen.findByTestId('workflow-row-alpha-flow')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-row-beta')).toBeInTheDocument()
    expect(screen.getByText('alpha-flow')).toBeInTheDocument()
    expect(screen.getByText('/p/workflows/beta.json')).toBeInTheDocument()
  })

  test('shows the no-cwd prompt when no project is active', async () => {
    let fetched = false
    server.use(
      http.get(`${BASE}/workflows`, () => {
        fetched = true
        return HttpResponse.json({ workflows: [] })
      }),
    )

    renderWorkflowList()

    expect(await screen.findByTestId('no-cwd-prompt')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(fetched).toBe(false)
  })

  test('shows the empty state when the active project has no workflows', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))

    renderWorkflowList()

    expect(await screen.findByTestId('no-workflows-state')).toBeInTheDocument()
  })
})

describe('WorkflowList delete flow', () => {
  test('confirming delete sends DELETE and invalidates the workflows query', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let getCount = 0
    let deletedName = ''

    server.use(
      http.get(`${BASE}/workflows`, () => {
        getCount += 1
        return HttpResponse.json({
          workflows: [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }],
        })
      }),
      http.delete(`${BASE}/workflows/:name`, ({ params, request }) => {
        deletedName = String(params.name)
        expect(new URL(request.url).searchParams.get('cwd')).toBe('/p')
        return HttpResponse.json({ deleted: String(params.name) })
      }),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(within(row).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deletedName).toBe('alpha'))
    await waitFor(() => expect(getCount).toBeGreaterThan(1))
  })

  test('a 409 WORKFLOW_RUN_ACTIVE response shows a stop-run-first message and keeps the row', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'active-flow.json', path: '/p/workflows/active-flow.json' }],
        }),
      ),
      http.delete(`${BASE}/workflows/:name`, () =>
        HttpResponse.json(
          { code: 'WORKFLOW_RUN_ACTIVE', message: 'Workflow has an active run.' },
          { status: 409 },
        ),
      ),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-active-flow')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(within(row).getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByTestId('delete-error')).toHaveTextContent('Stop the active run first')
    expect(screen.getByTestId('workflow-row-active-flow')).toBeInTheDocument()
  })
})

describe('WorkflowList run flow', () => {
  test('clicking Run starts a run for the row and navigates to the run view', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let startBody: unknown = null

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }],
        }),
      ),
      http.post(`${BASE}/runs`, async ({ request }) => {
        startBody = await request.json()
        return HttpResponse.json({ runId: 'run-123', slug: 'alpha-run' })
      }),
    )

    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('button', { name: 'Run' }))

    await screen.findByTestId('run-page')
    expect(startBody).toEqual({ workflowPath: '/p/workflows/alpha.json', cwd: '/p' })
    expect(router.state.location.pathname).toBe('/runs/run-123')
  })

  test('a failed start shows an error banner and keeps the row', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }],
        }),
      ),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ message: 'Run rejected.' }, { status: 500 }),
      ),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('button', { name: 'Run' }))

    expect(await screen.findByTestId('start-error')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-row-alpha')).toBeInTheDocument()
  })
})

describe('WorkflowList navigation', () => {
  test('create action navigates to the new workflow route', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))
    const { router } = renderWorkflowList()

    await screen.findByTestId('no-workflows-state')
    await user.click(screen.getByRole('link', { name: 'New workflow' }))

    await screen.findByTestId('new-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/new')
  })

  test('duplicate action navigates to the new workflow route with the source name', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('link', { name: 'Duplicate' }))

    await screen.findByTestId('new-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/new')
    expect(router.state.location.search).toEqual({ from: 'alpha' })
  })

  test('edit action navigates to the selected workflow editor route', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('link', { name: 'Edit' }))

    await screen.findByTestId('edit-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/alpha/edit')
  })
})

describe('WorkflowList integration', () => {
  test('MSW list renders and delete removes a row after refetch', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let workflows: WorkflowItem[] = [
      { name: 'alpha.json', path: '/p/workflows/alpha.json' },
      { name: 'beta.json', path: '/p/workflows/beta.json' },
    ]

    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })),
      http.delete(`${BASE}/workflows/:name`, ({ params }) => {
        workflows = workflows.filter(workflow => workflow.name !== `${String(params.name)}.json`)
        return HttpResponse.json({ deleted: String(params.name) })
      }),
    )

    renderWorkflowList()

    const alphaRow = await screen.findByTestId('workflow-row-alpha')
    expect(screen.getByTestId('workflow-row-beta')).toBeInTheDocument()

    await user.click(within(alphaRow).getByRole('button', { name: 'Delete' }))
    await user.click(within(alphaRow).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(screen.queryByTestId('workflow-row-alpha')).not.toBeInTheDocument())
    expect(screen.getByTestId('workflow-row-beta')).toBeInTheDocument()
  })
})
