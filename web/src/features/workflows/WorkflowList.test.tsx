import { describe, test, expect, beforeEach, vi } from 'vitest'
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
import { http, HttpResponse, delay } from 'msw'
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
    validateSearch: (search: Record<string, unknown>) => ({
      scope: search.scope === 'global' ? 'global' : 'project',
    }),
    component: function EditWorkflowPage() {
      const { scope } = editWorkflowRoute.useSearch()
      return <div data-testid="edit-workflow-page" data-scope={scope} />
    },
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
    // Re-skinned to shadcn Table/Card primitives.
    expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'table')
    expect(document.querySelector('[data-slot="card"]')).toBeInTheDocument()
  })

  test('renders skeleton rows (not plain text) while the first list request is in flight', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, async () => {
        await delay('infinite')
        return HttpResponse.json({ workflows: [] })
      }),
    )

    renderWorkflowList()

    const loading = await screen.findByTestId('workflows-loading')
    expect(within(loading).getAllByTestId('workflow-row-skeleton').length).toBeGreaterThan(0)
    expect(within(loading).queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  test('transitions from skeleton rows to populated rows once the query resolves', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    server.use(
      http.get(`${BASE}/workflows`, async () => {
        await gate
        return HttpResponse.json({
          workflows: [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }],
        })
      }),
    )

    renderWorkflowList()

    const loading = await screen.findByTestId('workflows-loading')
    expect(within(loading).getAllByTestId('workflow-row-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    release()
    await screen.findByTestId('workflow-row-alpha')
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByTestId('workflows-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-row-skeleton')).not.toBeInTheDocument()
  })

  test('shows the error state when the list query fails', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
    )

    renderWorkflowList()

    expect(await screen.findByTestId('workflows-error')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
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

  test('shows an action-oriented empty state linking to create a workflow', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))

    renderWorkflowList()

    const empty = await screen.findByTestId('no-workflows-state')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    const action = within(empty).getByTestId('create-first-workflow-action')
    expect(action).toHaveAttribute('href', '/workflows/new?scope=project')
  })
})

describe('WorkflowList empty-state action (integration)', () => {
  test('clicking the create-first-workflow action navigates to the new workflow route', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))

    const { router } = renderWorkflowList()

    const empty = await screen.findByTestId('no-workflows-state')
    await user.click(within(empty).getByTestId('create-first-workflow-action'))

    await screen.findByTestId('new-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/new')
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
  test('clicking Run opens the run dialog instead of starting immediately', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let startCalled = false

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'alpha.json', path: '/p/workflows/alpha.json' }],
        }),
      ),
      http.post(`${BASE}/runs`, () => {
        startCalled = true
        return HttpResponse.json({ runId: 'run-123', slug: 'alpha-run' })
      }),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('button', { name: 'Run' }))

    const dialog = await screen.findByTestId('run-dialog')
    expect(within(dialog).getByLabelText(/branch/i)).toBeInTheDocument()
    expect(startCalled).toBe(false)
  })

  test('submitting the dialog with a blank branch starts a non-isolated run and navigates', async () => {
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
    const dialog = await screen.findByTestId('run-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }))

    await screen.findByTestId('run-page')
    // Blank branch ⇒ no `branch` key ⇒ byte-for-byte identical to the old
    // inline-start request body.
    expect(startBody).toEqual({ workflowPath: '/p/workflows/alpha.json', cwd: '/p' })
    expect(router.state.location.pathname).toBe('/runs/run-123')
  })

  test('a non-empty branch is forwarded (trimmed) to startRun as an isolation request', async () => {
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
        return HttpResponse.json({ runId: 'run-9', slug: 'alpha-run' })
      }),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('button', { name: 'Run' }))
    const dialog = await screen.findByTestId('run-dialog')
    await user.type(within(dialog).getByLabelText(/branch/i), '  feature/iso  ')
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }))

    await screen.findByTestId('run-page')
    expect(startBody).toEqual({
      workflowPath: '/p/workflows/alpha.json',
      cwd: '/p',
      branch: 'feature/iso',
    })
  })

  test('a failed start shows an error in the dialog and keeps the row', async () => {
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
    const dialog = await screen.findByTestId('run-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }))

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

  test('duplicate action navigates to the new workflow route with the source name and scope', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [{ name: 'alpha.json', path: '/p/workflows/alpha.json', scope: 'project' }]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('link', { name: 'Duplicate' }))

    await screen.findByTestId('new-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/new')
    expect(router.state.location.search).toEqual({ from: 'alpha', scope: 'project' })
  })

  test("duplicating a global workflow carries scope=global into the new workflow route", async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'shared.json', path: '/global/workflows/shared.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-shared')
    await user.click(within(row).getByRole('link', { name: 'Duplicate' }))

    await screen.findByTestId('new-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/new')
    expect(router.state.location.search).toEqual({ from: 'shared', scope: 'global' })
  })

  test('edit action navigates to the selected workflow editor route', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [{ name: 'alpha.json', path: '/p/workflows/alpha.json', scope: 'project' }]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    await user.click(within(row).getByRole('link', { name: 'Edit' }))

    await screen.findByTestId('edit-workflow-page')
    expect(router.state.location.pathname).toBe('/workflows/alpha/edit')
  })

  test('action links are styled by the canonical Button primitive, not a hand-copied class string', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [{ name: 'alpha.json', path: '/p/workflows/alpha.json', scope: 'project' }]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-alpha')
    for (const name of ['Edit', 'Duplicate']) {
      const link = within(row).getByRole('link', { name })
      // data-slot="button" only comes from the Button primitive (via asChild Slot),
      // proving the styling has a single source of truth.
      expect(link).toHaveAttribute('data-slot', 'button')
      expect(link.className).toContain('border-input')
      expect(link.className).toContain('h-8')
    }

    const newLink = screen.getByRole('link', { name: 'New workflow' })
    expect(newLink).toHaveAttribute('data-slot', 'button')
  })
})

describe('WorkflowList scope badges', () => {
  test('renders project and global rows, each with the matching scope badge', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'alpha.json', path: '/p/workflows/alpha.json', scope: 'project' },
      { name: 'shared.json', path: '/global/workflows/shared.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))

    renderWorkflowList()

    const projectRow = await screen.findByTestId('workflow-row-alpha')
    const globalRow = screen.getByTestId('workflow-row-shared')
    expect(within(projectRow).getByTestId('workflow-scope-badge')).toHaveTextContent('Project')
    expect(within(globalRow).getByTestId('workflow-scope-badge')).toHaveTextContent('Global')
  })

  test('same-named workflows in different scopes both render without a duplicate-key warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'deploy.json', path: '/p/workflows/deploy.json', scope: 'project' },
      { name: 'deploy.json', path: '/global/workflows/deploy.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))

    renderWorkflowList()

    await waitFor(() => expect(screen.getAllByTestId('workflow-row-deploy')).toHaveLength(2))
    const badges = screen.getAllByTestId('workflow-scope-badge')
    const labels = badges.map(badge => badge.textContent)
    expect(labels).toEqual(expect.arrayContaining(['Project', 'Global']))

    const duplicateKeyWarnings = errorSpy.mock.calls.filter(call =>
      String(call[0]).toLowerCase().includes('same key'),
    )
    expect(duplicateKeyWarnings).toHaveLength(0)
    errorSpy.mockRestore()
  })

  test('confirming delete on one of two same-named rows activates only that row', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'deploy.json', path: '/p/workflows/deploy.json', scope: 'project' },
      { name: 'deploy.json', path: '/global/workflows/deploy.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))

    renderWorkflowList()

    await waitFor(() => expect(screen.getAllByTestId('workflow-row-deploy')).toHaveLength(2))
    const rows = screen.getAllByTestId('workflow-row-deploy')
    const projectRow = rows.find(
      row => within(row).getByTestId('workflow-scope-badge').dataset.scope === 'project',
    )!
    const globalRow = rows.find(
      row => within(row).getByTestId('workflow-scope-badge').dataset.scope === 'global',
    )!

    await user.click(within(projectRow).getByRole('button', { name: 'Delete' }))

    // Only the clicked (project) row enters the confirming state; the same-named
    // global row keeps its default Delete action.
    expect(within(projectRow).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(within(projectRow).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(within(globalRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(within(globalRow).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  })

  test('opening the run dialog from one of two same-named rows starts that row\'s workflow', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'deploy.json', path: '/p/workflows/deploy.json', scope: 'project' },
      { name: 'deploy.json', path: '/global/workflows/deploy.json', scope: 'global' },
    ]
    let startBody: unknown = null
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })),
      http.post(`${BASE}/runs`, async ({ request }) => {
        startBody = await request.json()
        return HttpResponse.json({ runId: 'run-1', slug: 'deploy-run' })
      }),
    )

    renderWorkflowList()

    await waitFor(() => expect(screen.getAllByTestId('workflow-row-deploy')).toHaveLength(2))
    const rows = screen.getAllByTestId('workflow-row-deploy')
    const projectRow = rows.find(
      row => within(row).getByTestId('workflow-scope-badge').dataset.scope === 'project',
    )!

    // Opening the dialog from the project row and starting must forward the
    // project workflow's path, not the same-named global one.
    await user.click(within(projectRow).getByRole('button', { name: 'Run' }))
    const dialog = await screen.findByTestId('run-dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Start run' }))

    await waitFor(() =>
      expect(startBody).toEqual({ workflowPath: '/p/workflows/deploy.json', cwd: '/p' }),
    )
  })
})

describe('WorkflowList scope routing', () => {
  test("a row's edit action carries that row's scope into the editor route", async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'shared.json', path: '/global/workflows/shared.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))
    const { router } = renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-shared')
    await user.click(within(row).getByRole('link', { name: 'Edit' }))

    const editPage = await screen.findByTestId('edit-workflow-page')
    expect(editPage).toHaveAttribute('data-scope', 'global')
    expect(router.state.location.pathname).toBe('/workflows/shared/edit')
    expect(router.state.location.search).toEqual({ scope: 'global' })
  })

  test("a row's delete action sends DELETE with that row's scope", async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let deletedScope: string | null = null
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [{ name: 'shared.json', path: '/global/workflows/shared.json', scope: 'global' }],
        }),
      ),
      http.delete(`${BASE}/workflows/:name`, ({ request }) => {
        deletedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({ deleted: 'shared' })
      }),
    )

    renderWorkflowList()

    const row = await screen.findByTestId('workflow-row-shared')
    await user.click(within(row).getByRole('button', { name: 'Delete' }))
    await user.click(within(row).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deletedScope).toBe('global'))
  })
})

describe('WorkflowList integration', () => {
  test('a combined list from the hook shows global and project rows together with badges', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const workflows: WorkflowItem[] = [
      { name: 'project-flow.json', path: '/p/workflows/project-flow.json', scope: 'project' },
      { name: 'global-flow.json', path: '/global/workflows/global-flow.json', scope: 'global' },
    ]
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows })))

    renderWorkflowList()

    const projectRow = await screen.findByTestId('workflow-row-project-flow')
    const globalRow = screen.getByTestId('workflow-row-global-flow')
    expect(within(projectRow).getByText('Project')).toBeInTheDocument()
    expect(within(globalRow).getByText('Global')).toBeInTheDocument()
    expect(within(projectRow).getByText('/p/workflows/project-flow.json')).toBeInTheDocument()
    expect(within(globalRow).getByText('/global/workflows/global-flow.json')).toBeInTheDocument()
  })

  test('MSW list renders and delete removes a row after refetch', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    let workflows: WorkflowItem[] = [
      { name: 'alpha.json', path: '/p/workflows/alpha.json', scope: 'project' },
      { name: 'beta.json', path: '/p/workflows/beta.json', scope: 'project' },
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
