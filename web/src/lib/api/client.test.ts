import { describe, test, expect, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  listRuns,
  getRun,
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  getIdeCatalog,
  getHealth,
  startRun,
  stopRun,
  retryStep,
  ApiError,
  AttachFrameSchema,
  RunnerEventSchema,
  RunEventSchema,
  RunStatusSchema,
} from './client'
import type { IdeCatalog, RunSummary, RunDetail, WorkflowDoc, WorkflowItem } from './types'

const BASE = 'http://127.0.0.1:4517'

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    slug: 'abc-def',
    workflowPath: '/tmp/wf.json',
    currentStepId: null,
    status: 'running',
    startedAt: 1000,
    endedAt: null,
    attachedCount: 0,
    ...overrides,
  }
}

function makeRunDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    id: 'run-1',
    slug: 'abc-def',
    workflowPath: '/tmp/wf.json',
    status: 'running',
    currentStepId: null,
    visitedStepIds: [],
    startedAt: 1000,
    endedAt: null,
    attachedCount: 0,
    ...overrides,
  }
}

function makeWorkflowDoc(overrides: Partial<WorkflowDoc> = {}): WorkflowDoc {
  const name = overrides.name ?? 'who-is'
  return {
    name,
    path: `/tmp/test/workflows/${name}.json`,
    scope: 'project',
    workflow: {
      id: name,
      name: 'Who Is',
      steps: [
        {
          id: 'step-1',
          ide: 'opencode',
          agent: 'general',
          model: 'opencode/default',
          mode: 'autonomous',
          description: 'Identify the subject',
          edges: [],
        },
      ],
    },
    ...overrides,
  }
}

// Unit tests: endpoint functions

describe('listRuns', () => {
  test('issues GET /runs?cwd=...&all=true and returns RunSummary[]', async () => {
    const mockRuns = [makeRunSummary()]
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ runs: mockRuns })
      }),
    )

    const result = await listRuns({ cwd: '/tmp/test', all: true })

    expect(result).toEqual(mockRuns)
    const parsed = new URL(capturedUrl)
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
    expect(parsed.searchParams.get('all')).toBe('true')
  })

  test('omits all param when not requested', async () => {
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ runs: [] })
      }),
    )

    await listRuns()

    const parsed = new URL(capturedUrl)
    expect(parsed.searchParams.get('all')).toBeNull()
  })

  test('extracts runs array from { runs: [] } response envelope', async () => {
    const mockRuns = [makeRunSummary({ id: 'r1' }), makeRunSummary({ id: 'r2' })]
    server.use(
      http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: mockRuns })),
    )

    const result = await listRuns()
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('r1')
  })
})

describe('startRun', () => {
  test('POSTs body and returns { runId, slug }', async () => {
    let capturedBody: unknown = null

    server.use(
      http.post(`${BASE}/runs`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ runId: 'run-123', slug: 'abc-def' }, { status: 201 })
      }),
    )

    const result = await startRun({ workflowPath: '/tmp/wf.json', cwd: '/tmp' })

    expect(result).toEqual({ runId: 'run-123', slug: 'abc-def' })
    expect(capturedBody).toEqual({ workflowPath: '/tmp/wf.json', cwd: '/tmp' })
  })
})

describe('getRun', () => {
  test('fetches GET /runs/:id and returns RunDetail', async () => {
    const detail = makeRunDetail({ id: 'run-42', status: 'completed' })
    server.use(
      http.get(`${BASE}/runs/run-42`, () => HttpResponse.json(detail)),
    )

    const result = await getRun('run-42')
    expect(result).toEqual(detail)
  })
})

describe('stopRun', () => {
  test('POSTs to /runs/:id/stop and returns finalStatus', async () => {
    server.use(
      http.post(`${BASE}/runs/run-1/stop`, () =>
        HttpResponse.json({ finalStatus: 'aborted' }),
      ),
    )

    const result = await stopRun('run-1')
    expect(result.finalStatus).toBe('aborted')
  })
})

describe('retryStep', () => {
  test('POSTs to /runs/:id/retry-step and returns resumedStepId', async () => {
    server.use(
      http.post(`${BASE}/runs/run-1/retry-step`, () =>
        HttpResponse.json({ resumedStepId: 'step-2' }),
      ),
    )

    const result = await retryStep('run-1')
    expect(result.resumedStepId).toBe('step-2')
  })
})

describe('getHealth', () => {
  test('fetches /health and returns HealthReport', async () => {
    const report = { status: 'ok', pid: 1234, uptimeMs: 5000, activeRuns: 2, version: '1.0.0' }
    server.use(
      http.get(`${BASE}/health`, () => HttpResponse.json(report)),
    )

    const result = await getHealth()
    expect(result).toEqual(report)
  })
})

// Error normalization tests

describe('error normalization', () => {
  test('404 JSON error { code, message } is normalized to ApiError with status and code', async () => {
    server.use(
      http.get(`${BASE}/runs/unknown`, () =>
        HttpResponse.json(
          { code: 'UNKNOWN_RUN', message: 'Run not found' },
          { status: 404 },
        ),
      ),
    )

    try {
      await getRun('unknown')
      expect.fail('should have thrown ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(404)
      expect(apiErr.code).toBe('UNKNOWN_RUN')
      expect(apiErr.message).toBe('Run not found')
    }
  })

  test('non-JSON 500 response yields ApiError with status and generic message', async () => {
    server.use(
      http.get(`${BASE}/runs/broken`, () =>
        new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    )

    try {
      await getRun('broken')
      expect.fail('should have thrown ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(500)
      expect(apiErr.code).toBe('HTTP_ERROR')
    }
  })

  test('4xx error without code falls back to HTTP_ERROR code', async () => {
    server.use(
      http.get(`${BASE}/runs/bad`, () =>
        HttpResponse.json({ message: 'Bad request' }, { status: 400 }),
      ),
    )

    try {
      await getRun('bad')
      expect.fail('should have thrown ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(400)
      expect(apiErr.code).toBe('HTTP_ERROR')
      expect(apiErr.message).toBe('Bad request')
    }
  })
})

// Integration tests: MSW-mocked endpoints

describe('listWorkflows (integration)', () => {
  test('returns a combined scoped WorkflowList from GET /workflows?cwd=', async () => {
    const mockWorkflows: WorkflowItem[] = [
      { name: 'who-is.json', path: '/tmp/workflows/who-is.json', scope: 'project' },
      { name: 'deploy.json', path: '/state/workflows/deploy.json', scope: 'global' },
    ]

    let capturedCwd = ''
    server.use(
      http.get(`${BASE}/workflows`, ({ request }) => {
        capturedCwd = new URL(request.url).searchParams.get('cwd') ?? ''
        return HttpResponse.json({ workflows: mockWorkflows })
      }),
    )

    const result = await listWorkflows('/tmp/test')

    expect(capturedCwd).toBe('/tmp/test')
    expect(result).toEqual({ workflows: mockWorkflows })
    // The combined list carries a scope on every item (project + global).
    expect(result.workflows.map((w) => w.scope)).toEqual(['project', 'global'])
  })
})

describe('workflow CRUD client functions', () => {
  test("getWorkflow(cwd, scope, 'who-is') forwards scope alongside cwd, without .json", async () => {
    const doc = makeWorkflowDoc()
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/workflows/who-is`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(doc)
      }),
    )

    const result = await getWorkflow('/tmp/test', 'project', 'who-is')

    expect(result).toEqual(doc)
    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/workflows/who-is')
    expect(parsed.pathname).not.toContain('.json')
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
    expect(parsed.searchParams.get('scope')).toBe('project')
  })

  test('createWorkflow(cwd, "global", body) POSTs /workflows?cwd=&scope=global with a JSON body', async () => {
    const body = {
      name: 'new-flow',
      workflow: makeWorkflowDoc({ name: 'new-flow' }).workflow,
    }
    const response = makeWorkflowDoc({ name: 'new-flow', workflow: body.workflow })
    let capturedUrl = ''
    let capturedBody: unknown = null
    let capturedContentType = ''

    server.use(
      http.post(`${BASE}/workflows`, async ({ request }) => {
        capturedUrl = request.url
        capturedBody = await request.json()
        capturedContentType = request.headers.get('content-type') ?? ''
        return HttpResponse.json(response, { status: 201 })
      }),
    )

    const result = await createWorkflow('/tmp/test', 'global', body)

    expect(result).toEqual(response)
    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/workflows')
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
    expect(parsed.searchParams.get('scope')).toBe('global')
    expect(capturedContentType).toContain('application/json')
    expect(capturedBody).toEqual(body)
  })

  test('updateWorkflow with a name in the body issues the rename request to /workflows/{old}', async () => {
    const body = {
      name: 'renamed-flow',
      workflow: makeWorkflowDoc({ name: 'renamed-flow' }).workflow,
    }
    const response = makeWorkflowDoc({ name: 'renamed-flow', workflow: body.workflow })
    let capturedUrl = ''
    let capturedMethod = ''
    let capturedBody: unknown = null

    server.use(
      http.put(`${BASE}/workflows/old-flow`, async ({ request }) => {
        capturedUrl = request.url
        capturedMethod = request.method
        capturedBody = await request.json()
        return HttpResponse.json(response)
      }),
    )

    const result = await updateWorkflow('/tmp/test', 'project', 'old-flow', body)

    expect(result).toEqual(response)
    const parsed = new URL(capturedUrl)
    expect(capturedMethod).toBe('PUT')
    expect(parsed.pathname).toBe('/workflows/old-flow')
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
    expect(parsed.searchParams.get('scope')).toBe('project')
    expect(capturedBody).toEqual(body)
  })

  test('deleteWorkflow(cwd, "project", name) issues DELETE to /workflows/{name}?cwd=&scope=project', async () => {
    let capturedUrl = ''
    let capturedMethod = ''

    server.use(
      http.delete(`${BASE}/workflows/who-is`, ({ request }) => {
        capturedUrl = request.url
        capturedMethod = request.method
        return HttpResponse.json({ deleted: 'who-is', scope: 'project' })
      }),
    )

    const result = await deleteWorkflow('/tmp/test', 'project', 'who-is')

    expect(result).toEqual({ deleted: 'who-is', scope: 'project' })
    const parsed = new URL(capturedUrl)
    expect(capturedMethod).toBe('DELETE')
    expect(parsed.pathname).toBe('/workflows/who-is')
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
    expect(parsed.searchParams.get('scope')).toBe('project')
  })

  test("getIdeCatalog(cwd, 'opencode') requests /ide/opencode/catalog?cwd=...", async () => {
    const catalog: IdeCatalog = {
      reachable: true,
      agents: [{ id: 'general', name: 'general' }],
      models: [{ id: 'opencode/default', name: 'Default' }],
    }
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/ide/opencode/catalog`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(catalog)
      }),
    )

    const result = await getIdeCatalog('/tmp/test', 'opencode')

    expect(result).toEqual(catalog)
    const parsed = new URL(capturedUrl)
    expect(parsed.pathname).toBe('/ide/opencode/catalog')
    expect(parsed.searchParams.get('cwd')).toBe('/tmp/test')
  })

  test('a 409 response surfaces as an ApiError with the server code', async () => {
    server.use(
      http.post(`${BASE}/workflows`, () =>
        HttpResponse.json(
          { code: 'WORKFLOW_EXISTS', message: 'Workflow already exists: who-is' },
          { status: 409 },
        ),
      ),
    )

    try {
      await createWorkflow('/tmp/test', 'project', {
        name: 'who-is',
        workflow: makeWorkflowDoc().workflow,
      })
      expect.fail('should have thrown ApiError')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.status).toBe(409)
      expect(apiErr.code).toBe('WORKFLOW_EXISTS')
      expect(apiErr.message).toBe('Workflow already exists: who-is')
    }
  })
})

describe('workflow CRUD client functions (MSW integration)', () => {
  test('create to get round-trip returns the stored workflow document', async () => {
    const stored = new Map<string, WorkflowDoc>()

    server.use(
      http.post(`${BASE}/workflows`, async ({ request }) => {
        const cwd = new URL(request.url).searchParams.get('cwd')
        const body = (await request.json()) as { name: string; workflow: unknown }
        const doc: WorkflowDoc = {
          name: body.name,
          path: `${cwd}/workflows/${body.name}.json`,
          scope: 'project',
          workflow: body.workflow,
        }
        stored.set(body.name, doc)
        return HttpResponse.json(doc, { status: 201 })
      }),
      http.get(`${BASE}/workflows/:name`, ({ params }) => {
        const doc = stored.get(String(params.name))
        if (!doc) {
          return HttpResponse.json({ code: 'NOT_FOUND', message: 'not found' }, { status: 404 })
        }
        return HttpResponse.json(doc)
      }),
    )

    const workflow = makeWorkflowDoc({ name: 'round-trip' }).workflow
    const created = await createWorkflow('/tmp/test', 'project', { name: 'round-trip', workflow })
    const fetched = await getWorkflow('/tmp/test', 'project', 'round-trip')

    expect(created).toEqual(fetched)
    expect(fetched.workflow).toEqual(workflow)
  })
})

describe('base URL config (integration)', () => {
  const env = import.meta.env as Record<string, unknown>

  afterEach(() => {
    delete env.VITE_API_BASE_URL
  })

  test('requests use VITE_API_BASE_URL from lib/config.ts', async () => {
    env.VITE_API_BASE_URL = 'http://localhost:9999'

    let capturedUrl = ''
    server.use(
      http.get('http://localhost:9999/health', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          status: 'ok',
          pid: 1,
          uptimeMs: 0,
          activeRuns: 0,
          version: '1.0.0',
        })
      }),
    )

    await getHealth()
    expect(capturedUrl).toContain('localhost:9999')
  })
})

// Zod validators (AttachFrameSchema, RunnerEventSchema, RunEventSchema, RunStatusSchema)

describe('AttachFrameSchema', () => {
  test('parses snapshot frame', () => {
    const frame = {
      type: 'snapshot',
      snapshot: makeRunDetail(),
    }
    const result = AttachFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
  })

  test('parses backlog frame', () => {
    const frame = {
      type: 'backlog',
      entries: [],
      truncated: false,
    }
    const result = AttachFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
  })

  test('parses event frame', () => {
    const frame = {
      type: 'event',
      entry: { seq: 1, ts: 1000, stepId: null, event: { type: 'log', message: 'hello' } },
    }
    const result = AttachFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
  })

  test('parses an event frame wrapping a valid tool_call entry end to end', () => {
    const frame = {
      type: 'event',
      entry: {
        seq: 2,
        ts: 2000,
        stepId: 'step-1',
        event: {
          type: 'tool_call',
          call: {
            toolCallId: 'call_00_abc',
            status: 'in_progress',
            kind: 'read',
            title: 'Read src/index.ts',
          },
        },
      },
    }
    const result = AttachFrameSchema.safeParse(frame)
    expect(result.success).toBe(true)
  })

  test('parses status frame', () => {
    const result = AttachFrameSchema.safeParse({ type: 'status', status: 'completed' })
    expect(result.success).toBe(true)
  })

  test('parses error frame', () => {
    const result = AttachFrameSchema.safeParse({ type: 'error', code: 'ERR', message: 'bad' })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = AttachFrameSchema.safeParse({ type: 'unknown' })
    expect(result.success).toBe(false)
  })
})

describe('RunnerEventSchema', () => {
  test('parses banner event', () => {
    const result = RunnerEventSchema.safeParse({
      type: 'banner',
      step: { id: 'step-1' },
      index: 1,
    })
    expect(result.success).toBe(true)
  })

  test('parses stream event', () => {
    const result = RunnerEventSchema.safeParse({
      type: 'stream',
      kind: 'message',
      chunk: 'hello',
    })
    expect(result.success).toBe(true)
  })

  test('parses interactive event', () => {
    const result = RunnerEventSchema.safeParse({ type: 'interactive', enabled: true })
    expect(result.success).toBe(true)
  })

  test('rejects unknown event type', () => {
    const result = RunnerEventSchema.safeParse({ type: 'unknown' })
    expect(result.success).toBe(false)
  })

  // Pinned tool_call fixture — guards against silent web/server schema drift
  // (ADR-003). Mirrors the server `ToolCallView` shape field-for-field.
  function makeToolCallEvent(call: Record<string, unknown> = {}) {
    return {
      type: 'tool_call',
      call: {
        toolCallId: 'call_00_abc',
        status: 'completed',
        kind: 'execute',
        title: 'Bash: npm test',
        errorText: 'exit code 1',
        ...call,
      },
    }
  }

  test('parses a valid tool_call event and resolves the discriminated type', () => {
    const result = RunnerEventSchema.safeParse(makeToolCallEvent())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('tool_call')
      // discriminated union narrows; the call payload is fully typed
      if (result.data.type === 'tool_call') {
        expect(result.data.call.toolCallId).toBe('call_00_abc')
        expect(result.data.call.status).toBe('completed')
      }
    }
  })

  test('errorText is optional: a completed event without it parses', () => {
    const result = RunnerEventSchema.safeParse(
      makeToolCallEvent({ status: 'completed', errorText: undefined }),
    )
    expect(result.success).toBe(true)
  })

  test('rejects a tool_call with status outside the enum', () => {
    const result = RunnerEventSchema.safeParse(makeToolCallEvent({ status: 'cancelled' }))
    expect(result.success).toBe(false)
  })

  test('drops a tool_call missing toolCallId (fails parse, no throw)', () => {
    const result = RunnerEventSchema.safeParse(makeToolCallEvent({ toolCallId: undefined }))
    expect(result.success).toBe(false)
  })
})

describe('RunEventSchema', () => {
  test('parses a run event', () => {
    const result = RunEventSchema.safeParse({
      seq: 1,
      ts: 1000,
      stepId: 'step-1',
      event: { type: 'log', message: 'hello' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts null stepId', () => {
    const result = RunEventSchema.safeParse({
      seq: 1,
      ts: 1000,
      stepId: null,
      event: {},
    })
    expect(result.success).toBe(true)
  })
})

describe('RunStatusSchema', () => {
  test.each(['running', 'completed', 'failed', 'crashed', 'aborted'])(
    'accepts %s',
    (status) => {
      expect(RunStatusSchema.safeParse(status).success).toBe(true)
    },
  )

  test('rejects unknown status', () => {
    expect(RunStatusSchema.safeParse('pending').success).toBe(false)
  })
})
