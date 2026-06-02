import { describe, test, expect, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/setup'
import {
  listRuns,
  getRun,
  listWorkflows,
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
import type { RunSummary, RunDetail, WorkflowItem } from './types'

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
  test('returns WorkflowList from GET /workflows?cwd=', async () => {
    const mockWorkflows: WorkflowItem[] = [
      { name: 'who-is.json', path: '/tmp/workflows/who-is.json' },
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
