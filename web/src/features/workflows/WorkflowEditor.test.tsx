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
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { WorkflowEditor } from './WorkflowEditor'
import { WorkflowList } from './WorkflowList'
import { workflowDocToFormData } from './WorkflowDraftSchema'
import { useWorkflow } from './useWorkflow'
import type { WorkflowDoc } from '@/lib/api/types'

const BASE = 'http://127.0.0.1:4517/api'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

// ── Render helpers ───────────────────────────────────────────────────────────

function renderEditor(
  props: Parameters<typeof WorkflowEditor>[0] = { mode: 'create' },
  queryClient = makeQueryClient(),
) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <WorkflowEditor {...props} />,
  })
  const workflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workflows',
    component: () => <div data-testid="workflows-page" />,
  })
  const routeTree = rootRoute.addChildren([editorRoute, workflowsRoute])
  const history = createMemoryHistory({ initialEntries: ['/'] })
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

function makeHookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  // The IDE select persists the last choice to localStorage as the default for
  // newly added steps; clear it so tests don't leak the default across cases.
  localStorage.clear()
})

// ── No-cwd guard ──────────────────────────────────────────────────────────────

describe('WorkflowEditor — no cwd', () => {
  test('shows no-cwd-prompt when there is no active working directory', async () => {
    renderEditor({ mode: 'create' })
    expect(await screen.findByTestId('no-cwd-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('workflow-editor-form')).not.toBeInTheDocument()
  })
})

// ── Form rendering ────────────────────────────────────────────────────────────

describe('WorkflowEditor — rendering', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('renders the editor form with Add Step button', async () => {
    renderEditor({ mode: 'create' })
    expect(await screen.findByTestId('workflow-editor-form')).toBeInTheDocument()
    expect(screen.getByTestId('add-step-button')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-filename-input')).toBeInTheDocument()
  })

  test('shows "New Workflow" heading for create mode', async () => {
    renderEditor({ mode: 'create' })
    expect(await screen.findByText('New Workflow')).toBeInTheDocument()
  })

  test('shows edit heading with workflow name for edit mode', async () => {
    renderEditor({ mode: 'edit', existingName: 'my-flow' })
    expect(await screen.findByText('Edit: my-flow')).toBeInTheDocument()
  })
})

// ── Add / remove / reorder steps ──────────────────────────────────────────────

describe('WorkflowEditor — step array management', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('add step appends a new step row', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    expect(screen.getByTestId('step-row-0')).toBeInTheDocument()

    await user.click(screen.getByTestId('add-step-button'))
    expect(screen.getByTestId('step-row-1')).toBeInTheDocument()
  })

  test('remove step deletes the correct row', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))
    expect(screen.getByTestId('step-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-row-1')).toBeInTheDocument()

    // type identifiers to track positions
    await user.clear(screen.getByTestId('step-id-input-0'))
    await user.type(screen.getByTestId('step-id-input-0'), 'alpha')
    await user.clear(screen.getByTestId('step-id-input-1'))
    await user.type(screen.getByTestId('step-id-input-1'), 'beta')

    await user.click(screen.getByTestId('remove-step-button-0'))

    // only one row left and it should be beta
    expect(screen.queryByTestId('step-row-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('step-id-input-0')).toHaveValue('beta')
  })

  test('reorder step moves a step up', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))

    await user.clear(screen.getByTestId('step-id-input-0'))
    await user.type(screen.getByTestId('step-id-input-0'), 'first')
    await user.clear(screen.getByTestId('step-id-input-1'))
    await user.type(screen.getByTestId('step-id-input-1'), 'second')

    await user.click(screen.getByTestId('move-step-up-1'))

    expect(screen.getByTestId('step-id-input-0')).toHaveValue('second')
    expect(screen.getByTestId('step-id-input-1')).toHaveValue('first')
  })
})

// ── Validation ────────────────────────────────────────────────────────────────

describe('WorkflowEditor — validation blocking', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  async function fillValidStep(user: ReturnType<typeof userEvent.setup>, index: number, id: string) {
    await user.clear(screen.getByTestId(`step-id-input-${index}`))
    await user.type(screen.getByTestId(`step-id-input-${index}`), id)
    await user.clear(screen.getByTestId(`step-agent-input-${index}`))
    await user.type(screen.getByTestId(`step-agent-input-${index}`), 'agent')
    await user.clear(screen.getByTestId(`step-model-input-${index}`))
    await user.type(screen.getByTestId(`step-model-input-${index}`), 'model')
  }

  test('saving with two steps sharing an id shows a duplicate-id field error and blocks submit', async () => {
    const user = userEvent.setup()
    let saved = false
    server.use(
      http.post(`${BASE}/workflows`, () => {
        saved = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'test-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))

    await fillValidStep(user, 0, 'step-1')
    await fillValidStep(user, 1, 'step-1') // duplicate

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('step-id-error-1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('step-id-error-1').textContent).toMatch(/duplicate/i)
    expect(saved).toBe(false)
  })

  test('edge with a dangling next_step (no matching step) shows a field error and blocks submit', async () => {
    const user = userEvent.setup()
    let saved = false
    server.use(
      http.post(`${BASE}/workflows`, () => {
        saved = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    // The target is now a <select>, so an arbitrary value can no longer be
    // typed in. A dangling reference can still arrive when editing a workflow
    // whose edge points at an id that no longer exists; load one via
    // initialValues and assert it is preserved and flagged on save.
    const doc: WorkflowDoc = {
      name: 'dangling-flow',
      path: '/p/workflows/dangling-flow.json',
      scope: 'project',
      workflow: {
        id: 'd',
        name: 'Dangling',
        description: '',
        version: '1.0',
        steps: [
          {
            id: 'step-1',
            agent: 'agent',
            model: 'model',
            ide: 'opencode',
            mode: 'interactive',
            description: '',
            edges: [{ next_step: 'nonexistent', intent: '' }],
          },
        ],
      },
    }
    const initialValues = workflowDocToFormData(doc, 'dangling-flow')
    renderEditor({ mode: 'create', initialValues })
    await screen.findByTestId('workflow-editor-form')

    // the dangling reference is kept as a selectable option, not dropped: the
    // Radix Select trigger reflects the persisted, unmatched value.
    const trigger = screen.getByTestId('edge-next-step-input-0-0')
    expect(trigger).toHaveTextContent('nonexistent (missing)')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('edge-next-step-error-0-0')).toBeInTheDocument()
    })
    expect(screen.getByTestId('edge-next-step-error-0-0').textContent).toMatch(/nonexistent/)
    expect(saved).toBe(false)
  })
})

// ── Duplicate (prefill) mode ──────────────────────────────────────────────────

describe('WorkflowEditor — duplicate prefill mode', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  const sourceDoc: WorkflowDoc = {
    name: 'source-flow',
    path: '/p/workflows/source-flow.json',
    scope: 'project',
    workflow: {
      id: 'source-id',
      name: 'Source Flow',
      description: 'Original workflow',
      version: '2.0',
      steps: [
        {
          id: 'step-a',
          agent: 'arch-agent',
          model: 'arch-model',
          ide: 'opencode',
          mode: 'interactive',
          description: 'Step A',
          edges: [],
        },
      ],
    },
  }

  test('prefills form fields from the source workflow', async () => {
    const initialValues = workflowDocToFormData(sourceDoc, '')
    renderEditor({ mode: 'create', initialValues })

    await screen.findByTestId('workflow-editor-form')

    expect(screen.getByTestId('step-id-input-0')).toHaveValue('step-a')
    expect(screen.getByTestId('step-agent-input-0')).toHaveValue('arch-agent')
    expect(screen.getByTestId('step-model-input-0')).toHaveValue('arch-model')
  })

  test('fileName is empty (blank) in duplicate mode so user must enter a new name', async () => {
    const initialValues = workflowDocToFormData(sourceDoc, '')
    renderEditor({ mode: 'create', initialValues })

    await screen.findByTestId('workflow-filename-input')
    expect(screen.getByTestId('workflow-filename-input')).toHaveValue('')
  })
})

// ── Save success ──────────────────────────────────────────────────────────────

describe('WorkflowEditor — save success', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('a successful create calls createWorkflow and navigates to the workflows list', async () => {
    const user = userEvent.setup()
    let capturedBody: unknown = null

    server.use(
      http.post(`${BASE}/workflows`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { name: 'new-flow', path: '/p/workflows/new-flow.json', workflow: {} },
          { status: 201 },
        )
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({ mode: 'create' })

    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'new-flow')
    await user.click(screen.getByTestId('add-step-button'))

    const stepIdx = 0
    await user.type(screen.getByTestId(`step-id-input-${stepIdx}`), 'step-1')
    await user.type(screen.getByTestId(`step-agent-input-${stepIdx}`), 'my-agent')
    await user.type(screen.getByTestId(`step-model-input-${stepIdx}`), 'my-model')
    await user.type(screen.getByTestId(`step-variant-input-${stepIdx}`), 'high')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })

    expect(capturedBody).toMatchObject({
      name: 'new-flow',
      workflow: { steps: [{ variant: 'high' }] },
    })
  })

  test('a successful edit calls updateWorkflow and navigates to the workflows list', async () => {
    const user = userEvent.setup()
    let updatedName = ''

    const existingDoc: WorkflowDoc = {
      name: 'existing-flow',
      path: '/p/workflows/existing-flow.json',
      scope: 'project',
      workflow: {
        id: 'ex',
        name: 'Existing',
        description: '',
        version: '1.0',
        steps: [
          {
            id: 'step-1',
            agent: 'old-agent',
            model: 'old-model',
            ide: 'claude-code',
            mode: 'interactive',
            description: '',
            edges: [],
          },
        ],
      },
    }

    server.use(
      http.put(`${BASE}/workflows/:name`, async ({ params }) => {
        updatedName = String(params.name)
        return HttpResponse.json({
          name: String(params.name),
          path: `/p/workflows/${String(params.name)}.json`,
          workflow: {},
        })
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({
      mode: 'edit',
      existingName: 'existing-flow',
      initialValues: workflowDocToFormData(existingDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    // update agent
    const agentInput = screen.getByTestId('step-agent-input-0')
    await user.clear(agentInput)
    await user.type(agentInput, 'new-agent')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(updatedName).toBe('existing-flow')
  })

  test('an edit that renames the file sends the new name in the PUT body', async () => {
    const user = userEvent.setup()
    let putBody: unknown = null

    const existingDoc: WorkflowDoc = {
      name: 'old-name',
      path: '/p/workflows/old-name.json',
      scope: 'project',
      workflow: {
        id: 'ex',
        name: 'Existing',
        description: '',
        version: '1.0',
        steps: [
          {
            id: 'step-1',
            agent: 'agent',
            model: 'model',
            ide: 'claude-code',
            mode: 'interactive',
            description: '',
            edges: [],
          },
        ],
      },
    }

    server.use(
      http.put(`${BASE}/workflows/:name`, async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({
          name: 'new-name',
          path: '/p/workflows/new-name.json',
          workflow: {},
        })
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({
      mode: 'edit',
      existingName: 'old-name',
      initialValues: workflowDocToFormData(existingDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    const fileNameInput = screen.getByTestId('workflow-filename-input')
    await user.clear(fileNameInput)
    await user.type(fileNameInput, 'new-name')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(putBody).not.toBeNull()
    expect((putBody as { name?: string }).name).toBe('new-name')
  })
})

// ── Edit: out-of-catalog ide round-trip ───────────────────────────────────────

describe('WorkflowEditor — out-of-catalog ide', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  const customIdeDoc: WorkflowDoc = {
    name: 'custom-ide-flow',
    path: '/p/workflows/custom-ide-flow.json',
    scope: 'project',
    workflow: {
      id: 'custom-ide',
      name: 'Custom IDE Flow',
      description: '',
      version: '1.0',
      steps: [
        {
          id: 'step-1',
          agent: 'some-agent',
          model: 'some-model',
          ide: 'cursor', // not one of the four built-in profiles
          mode: 'interactive',
          description: '',
          edges: [],
        },
      ],
    },
  }

  test('renders a custom option so an unsupported ide is shown selected', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
    )

    renderEditor({
      mode: 'edit',
      existingName: 'custom-ide-flow',
      initialValues: workflowDocToFormData(customIdeDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    // The Radix Select trigger reflects the persisted, unsupported ide.
    const trigger = screen.getByTestId('step-ide-select-0')
    expect(trigger).toHaveTextContent('cursor (custom)')

    // Opening the listbox shows the custom value as a selectable option.
    await user.click(trigger)
    expect(
      await screen.findByRole('option', { name: 'cursor (custom)' }),
    ).toBeInTheDocument()
  })

  test('an untouched save preserves the unsupported ide in the PUT body', async () => {
    const user = userEvent.setup()
    let putBody: unknown = null

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
      http.put(`${BASE}/workflows/:name`, async ({ request }) => {
        putBody = await request.json()
        return HttpResponse.json({
          name: 'custom-ide-flow',
          path: '/p/workflows/custom-ide-flow.json',
          workflow: {},
        })
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({
      mode: 'edit',
      existingName: 'custom-ide-flow',
      initialValues: workflowDocToFormData(customIdeDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    // Do not touch the ide select — save as-is.
    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })

    const body = putBody as { workflow: { steps: Array<{ ide: string }> } }
    expect(body.workflow.steps[0].ide).toBe('cursor')
  })
})

// ── shadcn Select fields (ide / mode) ─────────────────────────────────────────

describe('WorkflowEditor — shadcn Select fields', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('a new step renders all field controls with their testids', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))

    expect(screen.getByTestId('step-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-id-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-ide-select-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-mode-select-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-agent-input-0')).toBeInTheDocument()
    expect(screen.getByTestId('step-model-input-0')).toBeInTheDocument()
  })

  test('selecting an IDE via the Select updates the Controller-bound ide value', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
    )
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))

    const trigger = screen.getByTestId('step-ide-select-0')
    // Default is claude-code
    expect(trigger).toHaveTextContent('claude-code')

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'codex' }))

    expect(trigger).toHaveTextContent('codex')
  })

  test('a newly added step defaults to the last selected IDE', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
    )
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))

    // First step starts on the claude-code fallback, then user picks opencode.
    const firstTrigger = screen.getByTestId('step-ide-select-0')
    expect(firstTrigger).toHaveTextContent('claude-code')
    await user.click(firstTrigger)
    await user.click(await screen.findByRole('option', { name: 'opencode' }))
    expect(firstTrigger).toHaveTextContent('opencode')

    // The next added step inherits the persisted choice rather than claude-code.
    await user.click(screen.getByTestId('add-step-button'))
    expect(screen.getByTestId('step-ide-select-1')).toHaveTextContent('opencode')
    expect(localStorage.getItem('wfr.lastIde')).toBe('opencode')
  })

  test('mode Select toggles between interactive and autonomous', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
    )
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))

    const trigger = screen.getByTestId('step-mode-select-0')
    expect(trigger).toHaveTextContent('interactive')

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'autonomous' }))
    expect(trigger).toHaveTextContent('autonomous')

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'interactive' }))
    expect(trigger).toHaveTextContent('interactive')
  })

  test('an invalid filename surfaces filename-error and blocks submit', async () => {
    const user = userEvent.setup()
    let saved = false
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
      http.post(`${BASE}/workflows`, () => {
        saved = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'bad/name')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('filename-error')).toBeInTheDocument()
    })
    expect(saved).toBe(false)
  })

  test('move-up/move-down buttons are disabled at the list boundaries', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))

    // First step cannot move up; last step cannot move down.
    expect(screen.getByTestId('move-step-up-0')).toBeDisabled()
    expect(screen.getByTestId('move-step-down-0')).toBeEnabled()
    expect(screen.getByTestId('move-step-up-1')).toBeEnabled()
    expect(screen.getByTestId('move-step-down-1')).toBeDisabled()
  })
})

// ── Server 400 WORKFLOW_INVALID ───────────────────────────────────────────────

describe('WorkflowEditor — server 400 WORKFLOW_INVALID', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('server 400 WORKFLOW_INVALID is shown and form state is preserved', async () => {
    const user = userEvent.setup()

    server.use(
      http.post(`${BASE}/workflows`, () =>
        HttpResponse.json(
          { code: 'WORKFLOW_INVALID', message: 'Step mode is invalid.' },
          { status: 400 },
        ),
      ),
    )

    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'bad-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('server-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('server-error').textContent).toMatch(/Step mode is invalid/)

    // form state is preserved — filename still there
    expect(screen.getByTestId('workflow-filename-input')).toHaveValue('bad-flow')
  })

  test('non-400 server error shows a generic message', async () => {
    const user = userEvent.setup()

    server.use(
      http.post(`${BASE}/workflows`, () =>
        HttpResponse.json({ code: 'SERVER_ERROR', message: 'Internal error.' }, { status: 500 }),
      ),
    )

    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'bad-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(screen.getByTestId('server-error')).toBeInTheDocument()
    })
  })
})

// ── Integration: create and edit end-to-end via MSW ──────────────────────────

describe('WorkflowEditor — MSW integration', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('create end-to-end: valid form → POST /workflows → navigate to list', async () => {
    const user = userEvent.setup()
    let postBody: unknown = null

    server.use(
      http.post(`${BASE}/workflows`, async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json(
          { name: 'e2e-flow', path: '/p/workflows/e2e-flow.json', workflow: {} },
          { status: 201 },
        )
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-editor-form')

    await user.type(screen.getByTestId('workflow-filename-input'), 'e2e-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'my-agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'my-model')
    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })

    const body = postBody as { name: string; workflow: Record<string, unknown> }
    expect(body.name).toBe('e2e-flow')
    expect((body.workflow.steps as Array<unknown>)).toHaveLength(1)
  })

  test('edit end-to-end: prefilled form → PUT /workflows/:name → navigate to list', async () => {
    const user = userEvent.setup()
    let putCwd = ''

    const doc: WorkflowDoc = {
      name: 'edit-me',
      path: '/p/workflows/edit-me.json',
      scope: 'project',
      workflow: {
        id: 'edit-me',
        name: 'Edit Me',
        description: '',
        version: '1.0',
        steps: [
          {
            id: 'step-1',
            agent: 'old-agent',
            model: 'old-model',
            ide: 'claude-code',
            mode: 'interactive',
            description: '',
            edges: [],
          },
        ],
      },
    }

    server.use(
      http.put(`${BASE}/workflows/:name`, async ({ request }) => {
        putCwd = new URL(request.url).searchParams.get('cwd') ?? ''
        return HttpResponse.json({
          name: 'edit-me',
          path: '/p/workflows/edit-me.json',
          workflow: {},
        })
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({
      mode: 'edit',
      existingName: 'edit-me',
      initialValues: workflowDocToFormData(doc),
    })

    await screen.findByTestId('workflow-editor-form')

    const agentInput = screen.getByTestId('step-agent-input-0')
    await user.clear(agentInput)
    await user.type(agentInput, 'updated-agent')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(putCwd).toBe('/p')
  })
})

// ── Scope toggle (create) and read-only badge (edit) ─────────────────────────

describe('WorkflowEditor — scope toggle and badge', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  const globalDoc: WorkflowDoc = {
    name: 'shared-flow',
    path: '/state/workflow-runner/workflows/shared-flow.json',
    scope: 'global',
    workflow: {
      id: 'shared',
      name: 'Shared',
      description: '',
      version: '1.0',
      steps: [
        {
          id: 'step-1',
          agent: 'agent',
          model: 'model',
          ide: 'claude-code',
          mode: 'interactive',
          description: '',
          edges: [],
        },
      ],
    },
  }

  test('the create form scope selector defaults to Project', async () => {
    renderEditor({ mode: 'create' })
    await screen.findByTestId('scope-toggle')

    expect(screen.getByTestId('scope-toggle-project')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('scope-toggle-global')).toHaveAttribute('aria-pressed', 'false')
    // create mode shows the toggle, not a read-only badge
    expect(screen.queryByTestId('scope-badge')).not.toBeInTheDocument()
  })

  test('selecting Global and saving creates the workflow with scope=global', async () => {
    const user = userEvent.setup()
    let postScope: string | null = null

    server.use(
      http.post(`${BASE}/workflows`, ({ request }) => {
        postScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json(
          { name: 'g-flow', path: '/state/workflow-runner/workflows/g-flow.json', workflow: {} },
          { status: 201 },
        )
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'g-flow')
    await user.click(screen.getByTestId('scope-toggle-global'))
    expect(screen.getByTestId('scope-toggle-global')).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(postScope).toBe('global')
  })

  test('a default (untouched) create saves with scope=project', async () => {
    const user = userEvent.setup()
    let postScope: string | null = null

    server.use(
      http.post(`${BASE}/workflows`, ({ request }) => {
        postScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json(
          { name: 'p-flow', path: '/p/workflows/p-flow.json', workflow: {} },
          { status: 201 },
        )
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-filename-input')

    await user.type(screen.getByTestId('workflow-filename-input'), 'p-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(postScope).toBe('project')
  })

  test('editing a global workflow shows a read-only Global badge and no scope selector', async () => {
    renderEditor({
      mode: 'edit',
      existingName: 'shared-flow',
      scope: 'global',
      initialValues: workflowDocToFormData(globalDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    const badge = screen.getByTestId('scope-badge')
    expect(badge).toHaveTextContent('Global')
    expect(badge).toHaveAttribute('data-scope', 'global')
    expect(screen.queryByTestId('scope-toggle')).not.toBeInTheDocument()
  })

  test('saving an edit preserves the original scope (sends scope=global, no change)', async () => {
    const user = userEvent.setup()
    let putScope: string | null = null

    server.use(
      http.put(`${BASE}/workflows/:name`, ({ request }) => {
        putScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({
          name: 'shared-flow',
          path: '/state/workflow-runner/workflows/shared-flow.json',
          workflow: {},
        })
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const { router } = renderEditor({
      mode: 'edit',
      existingName: 'shared-flow',
      scope: 'global',
      initialValues: workflowDocToFormData(globalDoc),
    })

    await screen.findByTestId('workflow-editor-form')

    const agentInput = screen.getByTestId('step-agent-input-0')
    await user.clear(agentInput)
    await user.type(agentInput, 'updated-agent')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
    expect(putScope).toBe('global')
  })
})

// ── Integration: create-as-global, then list shows the Global badge ──────────

describe('WorkflowEditor — create-as-global integration', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  function renderEditorThenList(queryClient = makeQueryClient()) {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const editorRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <WorkflowEditor mode="create" />,
    })
    const listRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workflows',
      component: () => <WorkflowList />,
    })
    const routeTree = rootRoute.addChildren([editorRoute, listRoute])
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = createRouter({ routeTree, history })

    return {
      ...render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      ),
      router,
    }
  }

  test('create-as-global navigates to the list which renders the workflow badged Global', async () => {
    const user = userEvent.setup()

    server.use(
      http.post(`${BASE}/workflows`, () =>
        HttpResponse.json(
          {
            name: 'shared-flow',
            path: '/state/workflow-runner/workflows/shared-flow.json',
            workflow: {},
          },
          { status: 201 },
        ),
      ),
      // After the create + invalidation, the combined list returns the new global item.
      http.get(`${BASE}/workflows`, () =>
        HttpResponse.json({
          workflows: [
            {
              name: 'shared-flow.json',
              path: '/state/workflow-runner/workflows/shared-flow.json',
              scope: 'global',
            },
          ],
        }),
      ),
    )

    const { router } = renderEditorThenList()
    await screen.findByTestId('workflow-filename-input')

    await user.click(screen.getByTestId('scope-toggle-global'))
    await user.type(screen.getByTestId('workflow-filename-input'), 'shared-flow')
    await user.click(screen.getByTestId('add-step-button'))
    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'model')

    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })

    const badge = await screen.findByTestId('workflow-scope-badge')
    expect(badge).toHaveTextContent('Global')
    expect(badge).toHaveAttribute('data-scope', 'global')
  })
})

// ── useWorkflow hook ──────────────────────────────────────────────────────────

describe('useWorkflow', () => {
  test('fetches GET /workflows/:name with active cwd', async () => {
    const { renderHook, waitFor: waitForHook } = await import('@testing-library/react')

    useCwdStore.getState().addCwd('proj', '/p')
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          name: 'my-flow',
          path: '/p/workflows/my-flow.json',
          workflow: {},
        })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflow('my-flow'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })

    await waitForHook(() => expect(result.current.isSuccess).toBe(true))
    expect(new URL(capturedUrl).searchParams.get('cwd')).toBe('/p')
  })

  test('does not fetch without an active cwd', async () => {
    const { renderHook } = await import('@testing-library/react')

    let fetched = false
    server.use(
      http.get(`${BASE}/workflows/:name`, () => {
        fetched = true
        return HttpResponse.json({})
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useWorkflow('my-flow'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      ),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ── Cancel navigation ─────────────────────────────────────────────────────────

describe('WorkflowEditor — cancel button', () => {
  test('cancel navigates to the workflows list', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('proj', '/p')

    const { router } = renderEditor({ mode: 'create' })
    await screen.findByTestId('cancel-button')

    await user.click(screen.getByTestId('cancel-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })
  })
})

// ── Edge field management ─────────────────────────────────────────────────────

describe('WorkflowEditor — edge management within a step', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('add edge appends a new edge row inside a step', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-edge-button-0'))

    expect(screen.getByTestId('edge-row-0-0')).toBeInTheDocument()
  })

  test('remove edge deletes the edge row', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-edge-button-0'))
    await user.click(screen.getByTestId('add-edge-button-0'))

    expect(screen.getByTestId('edge-row-0-0')).toBeInTheDocument()
    expect(screen.getByTestId('edge-row-0-1')).toBeInTheDocument()

    await user.click(screen.getByTestId('remove-edge-button-0-0'))

    await waitFor(() => {
      expect(screen.queryByTestId('edge-row-0-1')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('edge-row-0-0')).toBeInTheDocument()
  })

  test('next-step dropdown lists sibling step ids and excludes the current step', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))

    await user.clear(screen.getByTestId('step-id-input-0'))
    await user.type(screen.getByTestId('step-id-input-0'), 'first')
    await user.clear(screen.getByTestId('step-id-input-1'))
    await user.type(screen.getByTestId('step-id-input-1'), 'second')

    await user.click(screen.getByTestId('add-edge-button-0'))

    // Open the Radix listbox and read the offered options.
    const trigger = screen.getByTestId('edge-next-step-input-0-0')
    await user.click(trigger)
    await screen.findByRole('option', { name: 'second' })
    const optionValues = screen
      .getAllByRole('option')
      .map(o => o.textContent)
    // the sibling step is offered; the step's own id is not (no trivial self-loop)
    expect(optionValues).toContain('second')
    expect(optionValues).not.toContain('first')
  })

  test('selecting a step in the next-step dropdown sets next_step', async () => {
    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('add-step-button')

    await user.click(screen.getByTestId('add-step-button'))
    await user.click(screen.getByTestId('add-step-button'))

    await user.clear(screen.getByTestId('step-id-input-1'))
    await user.type(screen.getByTestId('step-id-input-1'), 'target-step')

    await user.click(screen.getByTestId('add-edge-button-0'))

    const trigger = screen.getByTestId('edge-next-step-input-0-0')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'target-step' }))
    expect(trigger).toHaveTextContent('target-step')
  })
})

// ── Catalog integration: AgentModelPicker in editor ──────────────────────────

describe('AgentModelPicker — catalog integration', () => {
  beforeEach(() => {
    useCwdStore.getState().addCwd('proj', '/p')
  })

  test('selecting an IDE populates agent and model suggestions when catalog is reachable', async () => {
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, ({ params }) => {
        if (params.ide === 'opencode') {
          return HttpResponse.json({
            reachable: true,
            agents: [
              { id: 'architect-advisor', name: 'Architect Advisor' },
              { id: 'dev', name: 'Developer' },
            ],
            models: [{ id: 'big-model', name: 'Big Model' }],
          })
        }
        return HttpResponse.json({ reachable: false, agents: [], models: [] })
      }),
    )

    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-editor-form')

    await user.click(screen.getByTestId('add-step-button'))

    await user.click(screen.getByTestId('step-ide-select-0'))
    await user.click(await screen.findByRole('option', { name: 'opencode' }))

    await waitFor(() => {
      expect(screen.getByTestId('step-agent-input-0-status')).toHaveTextContent(
        /suggestions from ide/i,
      )
    })

    const datalistOptions = document.querySelectorAll('datalist option')
    const values = Array.from(datalistOptions).map(o => o.getAttribute('value'))
    expect(values).toContain('architect-advisor')
    expect(values).toContain('dev')
    expect(values).toContain('big-model')
  })

  test('unreachable IDE shows manual-only mode for agent and model pickers', async () => {
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({
          reachable: false,
          agents: [],
          models: [],
          reason: 'IDE not installed',
        }),
      ),
    )

    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-editor-form')

    await user.click(screen.getByTestId('add-step-button'))

    await waitFor(() => {
      expect(screen.getByTestId('step-agent-input-0-status')).toHaveTextContent(/ide unreachable/i)
    })
    expect(screen.getByTestId('step-model-input-0-status')).toHaveTextContent(/ide unreachable/i)
  })

  test('workflow saves with manually typed values when catalog is unreachable', async () => {
    let capturedBody: unknown = null

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({ reachable: false, agents: [], models: [] }),
      ),
      http.post(`${BASE}/workflows`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          { name: 'picker-flow', path: '/p/workflows/picker-flow.json', workflow: {} },
          { status: 201 },
        )
      }),
      http.get(`${BASE}/workflows`, () => HttpResponse.json({ workflows: [] })),
    )

    const user = userEvent.setup()
    const { router } = renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-editor-form')

    await user.type(screen.getByTestId('workflow-filename-input'), 'picker-flow')
    await user.click(screen.getByTestId('add-step-button'))

    await waitFor(() => {
      expect(screen.getByTestId('step-agent-input-0-status')).toHaveTextContent(/ide unreachable/i)
    })

    await user.type(screen.getByTestId('step-id-input-0'), 'step-1')
    await user.type(screen.getByTestId('step-agent-input-0'), 'my-agent')
    await user.type(screen.getByTestId('step-model-input-0'), 'my-model')
    await user.click(screen.getByTestId('save-button'))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/workflows')
    })

    const body = capturedBody as { name: string; workflow: Record<string, unknown> }
    expect(body.name).toBe('picker-flow')
    const steps = body.workflow.steps as Array<{ agent: string; model: string }>
    expect(steps[0].agent).toBe('my-agent')
    expect(steps[0].model).toBe('my-model')
  })

  test('switching IDE triggers a new catalog fetch', async () => {
    const fetchedIdes: string[] = []

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, ({ params }) => {
        fetchedIdes.push(String(params.ide))
        return HttpResponse.json({
          reachable: true,
          agents: [{ id: `${params.ide}-agent`, name: `${String(params.ide)} Agent` }],
          models: [],
        })
      }),
    )

    const user = userEvent.setup()
    renderEditor({ mode: 'create' })
    await screen.findByTestId('workflow-editor-form')

    await user.click(screen.getByTestId('add-step-button'))

    // Default IDE is claude-code
    await waitFor(() => {
      expect(fetchedIdes).toContain('claude-code')
    })

    // Switch to opencode via the Radix Select
    await user.click(screen.getByTestId('step-ide-select-0'))
    await user.click(await screen.findByRole('option', { name: 'opencode' }))

    await waitFor(() => {
      expect(fetchedIdes).toContain('opencode')
    })
  })
})

// ── New workflow route — from param (duplicate) ───────────────────────────────

describe('New workflow route — from param', () => {
  test('NewWorkflowPage shows loading state when fetching source for duplication', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const newWorkflowRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workflows/new',
      validateSearch: (search: Record<string, unknown>) => ({
        from: typeof search.from === 'string' ? search.from : undefined,
      }),
      component: () => {
        const { from } = newWorkflowRoute.useSearch()
        const { data: sourceDoc, isLoading } = useWorkflow(from)
        const activeCwd = useCwdStore(state => state.activeCwd())

        if (from && activeCwd && isLoading) {
          return <div data-testid="workflow-loading">Loading…</div>
        }

        const initialValues =
          from && sourceDoc ? workflowDocToFormData(sourceDoc, '') : undefined
        return <WorkflowEditor mode="create" initialValues={initialValues} />
      },
    })
    const routeTree = rootRoute.addChildren([newWorkflowRoute])
    const history = createMemoryHistory({ initialEntries: ['/workflows/new?from=source-flow'] })
    const router = createRouter({ routeTree, history })

    let resolveRequest!: () => void
    server.use(
      http.get(`${BASE}/workflows/:name`, () => {
        return new Promise(resolve => {
          resolveRequest = () =>
            resolve(
              HttpResponse.json({
                name: 'source-flow',
                path: '/p/workflows/source-flow.json',
                workflow: { id: 'src', name: 'Source', description: '', version: '1.0', steps: [] },
              }),
            )
        })
      }),
    )

    const qc = makeQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('workflow-loading')).toBeInTheDocument()

    resolveRequest()
    await waitFor(() =>
      expect(screen.queryByTestId('workflow-loading')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('workflow-editor-form')).toBeInTheDocument()
  })
})
