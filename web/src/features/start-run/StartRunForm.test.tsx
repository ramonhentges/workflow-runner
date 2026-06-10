import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
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
import { StartRunForm } from './StartRunForm'
import { useWorkflows } from './useWorkflows'

const BASE = 'http://127.0.0.1:4517'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Wrapper for renderHook tests (no router needed for useWorkflows)
function makeHookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// Full render helper with router (needed for useNavigate inside StartRunForm)
function renderForm(queryClient?: QueryClient) {
  const qc = queryClient ?? makeQueryClient()
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const startRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/start',
    component: StartRunForm,
  })
  const runViewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$runId',
    component: () => <div data-testid="run-view-page" />,
  })
  const routeTree = rootRoute.addChildren([startRoute, runViewRoute])
  const history = createMemoryHistory({ initialEntries: ['/start'] })
  const router = createRouter({ routeTree, history })

  return {
    ...render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    queryClient: qc,
    router,
  }
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
})

// ─── Unit: useWorkflows ──────────────────────────────────────────────────────

describe('useWorkflows', () => {
  test('issues GET /workflows?cwd=<active> when an active cwd is set', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedUrl = ''
    server.use(
      http.get(`${BASE}/workflows`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflows(), { wrapper: makeHookWrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const url = new URL(capturedUrl)
    expect(url.searchParams.get('cwd')).toBe('/projects/myapp')
  })

  test('does not fetch when no active cwd is set', async () => {
    let fetched = false
    server.use(
      http.get(`${BASE}/workflows`, () => {
        fetched = true
        return HttpResponse.json({ workflows: [] })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflows(), { wrapper: makeHookWrapper(qc) })

    // Give it time to possibly fire
    await new Promise(r => setTimeout(r, 50))

    expect(fetched).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('re-fetches with a new cwd path when the active cwd changes', async () => {
    const capturedUrls: string[] = []
    server.use(
      http.get(`${BASE}/workflows`, ({ request }) => {
        capturedUrls.push(request.url)
        return HttpResponse.json({ workflows: [] })
      }),
    )

    useCwdStore.getState().addCwd('proj-a', '/projects/a')

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflows(), { wrapper: makeHookWrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Switch to a different cwd
    useCwdStore.getState().addCwd('proj-b', '/projects/b')
    const cwds = useCwdStore.getState().cwds
    useCwdStore.getState().setActive(cwds[cwds.length - 1].id)

    await waitFor(() =>
      expect(capturedUrls.some(u => new URL(u).searchParams.get('cwd') === '/projects/b')).toBe(
        true,
      ),
    )
  })

  test('returns the workflows list on success', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'wf1.json', path: '/p/workflows/wf1.json', scope: 'project' },
            { name: 'wf2.json', path: '/p/workflows/wf2.json', scope: 'project' },
          ],
        }),
      ),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflows(), { wrapper: makeHookWrapper(qc) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data?.workflows).toHaveLength(2)
    expect(result.current.data?.workflows[0].name).toBe('wf1.json')
  })
})

// ─── Unit: no active cwd ────────────────────────────────────────────────────

describe('StartRunForm — no active cwd', () => {
  test('shows the select/add-cwd prompt when no active cwd is set', async () => {
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))

    renderForm()

    expect(await screen.findByTestId('no-cwd-prompt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start run/i })).not.toBeInTheDocument()
  })

  test('does not POST /runs when no active cwd is set', async () => {
    let posted = false
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () => {
        posted = true
        return HttpResponse.json({ runId: 'r1', slug: 'slug' })
      }),
    )

    renderForm()

    await screen.findByTestId('no-cwd-prompt')
    // No submit button rendered, so no POST can happen
    expect(posted).toBe(false)
  })
})

// ─── Unit: form validation ───────────────────────────────────────────────────

describe('StartRunForm — validation', () => {
  test('shows a validation error when submitting with no selection and no manual path', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })))

    renderForm()

    const btn = await screen.findByRole('button', { name: /start run/i })
    await user.click(btn)

    expect(await screen.findByTestId('validation-error')).toBeInTheDocument()
  })

  test('does not POST /runs when the form is invalid', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    let posted = false
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () => {
        posted = true
        return HttpResponse.json({ runId: 'r1', slug: 'slug' })
      }),
    )

    renderForm()

    const btn = await screen.findByRole('button', { name: /start run/i })
    await user.click(btn)

    await screen.findByTestId('validation-error')
    expect(posted).toBe(false)
  })
})

// ─── Unit: submission with manual path ──────────────────────────────────────

describe('StartRunForm — manual path submission', () => {
  test('POSTs the manual path with the active cwd', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedBody: unknown
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ runId: 'run-abc', slug: 'slug-abc' })
      }),
    )

    renderForm()

    const input = await screen.findByLabelText(/workflow path/i)
    await user.type(input, '/projects/myapp/workflows/wf.json')

    await user.click(screen.getByRole('button', { name: /start run/i }))

    await waitFor(() => {
      expect(capturedBody).toEqual({
        workflowPath: '/projects/myapp/workflows/wf.json',
        cwd: '/projects/myapp',
      })
    })
  })
})

// ─── Unit: submission with picker ───────────────────────────────────────────

describe('StartRunForm — picker selection', () => {
  test('POSTs the selected workflow path with the active cwd', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedBody: unknown
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'wf1.json', path: '/projects/myapp/workflows/wf1.json', scope: 'project' },
          ],
        }),
      ),
      http.post(`${BASE}/runs`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ runId: 'run-xyz', slug: 'slug-xyz' })
      }),
    )

    renderForm()

    // Wait for the shadcn Select trigger (Radix combobox) to appear, then
    // open it and choose the option by its visible workflow name. The option's
    // accessible name now also carries the scope badge text, so match loosely.
    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /wf1\.json/ }))

    await user.click(screen.getByRole('button', { name: /start run/i }))

    await waitFor(() => {
      expect(capturedBody).toEqual({
        workflowPath: '/projects/myapp/workflows/wf1.json',
        cwd: '/projects/myapp',
      })
    })
  })
})

// ─── Unit/Integration: scoped picker ────────────────────────────────────────

describe('StartRunForm — scoped picker', () => {
  test('lists both global and project workflows, each showing its scope', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'proj-wf.json', path: '/projects/myapp/workflows/proj-wf.json', scope: 'project' },
            { name: 'global-wf.json', path: '/home/u/.local/state/workflow-runner/workflows/global-wf.json', scope: 'global' },
          ],
        }),
      ),
    )

    renderForm()

    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)

    const projectOption = await screen.findByRole('option', { name: /proj-wf\.json/ })
    const globalOption = await screen.findByRole('option', { name: /global-wf\.json/ })
    expect(projectOption).toBeInTheDocument()
    expect(globalOption).toBeInTheDocument()

    // Each option carries a scope badge as the disambiguator.
    const badges = screen.getAllByTestId('workflow-scope-badge')
    const scopes = badges.map(b => b.getAttribute('data-scope'))
    expect(scopes).toContain('project')
    expect(scopes).toContain('global')
    expect(projectOption).toHaveTextContent('Project')
    expect(globalOption).toHaveTextContent('Global')
  })

  test('selecting a global workflow submits its path with the active cwd', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedBody: unknown
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'proj-wf.json', path: '/projects/myapp/workflows/proj-wf.json', scope: 'project' },
            { name: 'global-wf.json', path: '/home/u/.local/state/workflow-runner/workflows/global-wf.json', scope: 'global' },
          ],
        }),
      ),
      http.post(`${BASE}/runs`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ runId: 'run-global', slug: 'slug-global' })
      }),
    )

    renderForm()

    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /global-wf\.json/ }))

    await user.click(screen.getByRole('button', { name: /start run/i }))

    // The global item's absolute path runs against the active cwd, unchanged.
    await waitFor(() => {
      expect(capturedBody).toEqual({
        workflowPath: '/home/u/.local/state/workflow-runner/workflows/global-wf.json',
        cwd: '/projects/myapp',
      })
    })
  })
})

// ─── Unit: select/manual mutual exclusion ───────────────────────────────────

describe('StartRunForm — select/manual mutual exclusion', () => {
  test('selecting a workflow clears a previously typed manual path', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'wf1.json', path: '/projects/myapp/workflows/wf1.json', scope: 'project' },
          ],
        }),
      ),
    )

    renderForm()

    const manual = await screen.findByLabelText(/enter a path manually/i)
    await user.type(manual, '/some/manual/path.json')
    expect(manual).toHaveValue('/some/manual/path.json')

    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /wf1\.json/ }))

    // The Select now reflects the chosen workflow and the manual path is cleared.
    expect(trigger).toHaveTextContent('wf1.json')
    expect(manual).toHaveValue('')
  })

  test('typing a manual path clears the select selection', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'wf1.json', path: '/projects/myapp/workflows/wf1.json', scope: 'project' },
          ],
        }),
      ),
    )

    renderForm()

    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /wf1\.json/ }))
    expect(trigger).toHaveTextContent('wf1.json')

    const manual = screen.getByLabelText(/enter a path manually/i)
    await user.type(manual, '/some/manual/path.json')

    // The Select falls back to its placeholder once a manual path is typed.
    expect(trigger).toHaveTextContent('— select a workflow —')
    expect(manual).toHaveValue('/some/manual/path.json')
  })
})

// ─── Integration: successful run start navigation ────────────────────────────

describe('StartRunForm — integration: navigation', () => {
  test('navigates to /runs/<runId> after MSW returns two workflows and POST /runs succeeds', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            { name: 'alpha.json', path: '/projects/myapp/workflows/alpha.json', scope: 'project' },
            { name: 'beta.json', path: '/projects/myapp/workflows/beta.json', scope: 'project' },
          ],
        }),
      ),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ runId: 'new-run-id', slug: 'some-slug' }),
      ),
    )

    renderForm()

    const trigger = await screen.findByRole('combobox')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /alpha\.json/ }))
    await user.click(screen.getByRole('button', { name: /start run/i }))

    expect(await screen.findByTestId('run-view-page')).toBeInTheDocument()
  })

  test('navigates using the runId from the POST /runs response', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ runId: 'specific-run-id', slug: 'slug' }),
      ),
    )

    const { router } = renderForm()

    const input = await screen.findByLabelText(/workflow path/i)
    await user.type(input, '/p/workflows/wf.json')
    await user.click(screen.getByRole('button', { name: /start run/i }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/runs/specific-run-id')
    })
  })
})

// ─── Unit: workflow listing states ───────────────────────────────────────────

describe('StartRunForm — workflow listing states', () => {
  test('shows a loading indicator while the workflows query is pending', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, async () => {
        await new Promise(() => {}) // never resolves — keeps query in loading state
        return HttpResponse.json({ workflows: [] })
      }),
    )

    renderForm()

    expect(await screen.findByTestId('workflows-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('workflows-error')).not.toBeInTheDocument()
  })

  test('shows an error notice and renders the manual path input when the workflows query fails', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({ error: 'daemon down' }, { status: 500 }),
      ),
    )

    renderForm()

    expect(await screen.findByTestId('workflows-error')).toBeInTheDocument()
    expect(screen.queryByTestId('workflows-loading')).not.toBeInTheDocument()
    // Picker should not be present — no workflows data (no Radix combobox trigger)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    // Manual path fallback is still accessible
    expect(screen.getByLabelText(/workflow path/i)).toBeInTheDocument()
  })

  test('does not show loading or error notices after successful query', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    renderForm()

    // Wait for the query to complete
    await screen.findByRole('button', { name: /start run/i })
    await waitFor(() => expect(screen.queryByTestId('workflows-loading')).not.toBeInTheDocument())
    expect(screen.queryByTestId('workflows-error')).not.toBeInTheDocument()
  })
})

// ─── Integration: error handling ─────────────────────────────────────────────

describe('StartRunForm — integration: error handling', () => {
  test('renders the API error message inline when POST /runs returns a 400', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ code: 'INVALID_PATH', message: 'Workflow file not found.' }, { status: 400 }),
      ),
    )

    renderForm()

    const input = await screen.findByLabelText(/workflow path/i)
    await user.type(input, '/p/workflows/missing.json')
    await user.click(screen.getByRole('button', { name: /start run/i }))

    expect(await screen.findByTestId('submit-error')).toHaveTextContent('Workflow file not found.')
  })

  test('preserves the entered manual path after a submission error', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ code: 'ERR', message: 'Server error.' }, { status: 500 }),
      ),
    )

    renderForm()

    const input = await screen.findByLabelText(/workflow path/i)
    await user.type(input, '/p/workflows/wf.json')
    await user.click(screen.getByRole('button', { name: /start run/i }))

    await screen.findByTestId('submit-error')

    // The input must still contain what the user typed
    expect(input).toHaveValue('/p/workflows/wf.json')
  })

  test('does not navigate when POST /runs fails', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
      http.post(`${BASE}/runs`, () =>
        HttpResponse.json({ code: 'ERR', message: 'Nope.' }, { status: 500 }),
      ),
    )

    const { router } = renderForm()

    const input = await screen.findByLabelText(/workflow path/i)
    await user.type(input, '/p/workflows/wf.json')
    await user.click(screen.getByRole('button', { name: /start run/i }))

    await screen.findByTestId('submit-error')

    expect(router.state.location.pathname).toBe('/start')
  })
})
