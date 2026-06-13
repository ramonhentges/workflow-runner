import { z } from 'zod'
import { getApiBaseUrl } from '../config'
import type {
  RunSummary,
  RunDetail,
  WorkflowList,
  WorkflowDoc,
  WorkflowCreateBody,
  WorkflowUpdateBody,
  WorkflowDeleteResult,
  WorkflowScope,
  IdeCatalog,
  HealthReport,
  StartRunRequest,
} from './types'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function apiFetch<T>(
  path: string,
  opts: {
    method?: string
    params?: Record<string, string | undefined>
    body?: unknown
  } = {},
): Promise<T> {
  const base = getApiBaseUrl()
  // The HTTP API is mounted under /api on the daemon; callers pass a
  // leading-slash resource path (e.g. "/runs/:id") and we prefix it here.
  const url = new URL(`/api${path}`, base)
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v !== undefined) {
        url.searchParams.set(k, v)
      }
    }
  }

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    let code = 'HTTP_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const data = (await res.json()) as { code?: string; message?: string }
      if (data.code) code = data.code
      if (data.message) message = data.message
    } catch {
      // Non-JSON body — keep defaults
    }
    throw new ApiError(res.status, code, message)
  }

  return res.json() as Promise<T>
}

// Endpoint functions

export async function listRuns(opts: { cwd?: string; all?: boolean } = {}): Promise<RunSummary[]> {
  const params: Record<string, string | undefined> = {
    cwd: opts.cwd,
    ...(opts.all ? { all: 'true' } : {}),
  }
  const data = await apiFetch<{ runs: RunSummary[] }>('/runs', { params })
  return data.runs
}

export async function getRun(id: string): Promise<RunDetail> {
  return apiFetch<RunDetail>(`/runs/${encodeURIComponent(id)}`)
}

export async function listWorkflows(cwd: string): Promise<WorkflowList> {
  return apiFetch<WorkflowList>('/workflows', { params: { cwd } })
}

export async function getWorkflow(
  cwd: string,
  scope: WorkflowScope,
  name: string,
): Promise<WorkflowDoc> {
  return apiFetch<WorkflowDoc>(`/workflows/${encodeURIComponent(name)}`, { params: { cwd, scope } })
}

export async function createWorkflow(
  cwd: string,
  scope: WorkflowScope,
  body: WorkflowCreateBody,
): Promise<WorkflowDoc> {
  return apiFetch<WorkflowDoc>('/workflows', { method: 'POST', params: { cwd, scope }, body })
}

export async function updateWorkflow(
  cwd: string,
  scope: WorkflowScope,
  name: string,
  body: WorkflowUpdateBody,
): Promise<WorkflowDoc> {
  return apiFetch<WorkflowDoc>(`/workflows/${encodeURIComponent(name)}`, {
    method: 'PUT',
    params: { cwd, scope },
    body,
  })
}

export async function deleteWorkflow(
  cwd: string,
  scope: WorkflowScope,
  name: string,
): Promise<WorkflowDeleteResult> {
  return apiFetch<WorkflowDeleteResult>(`/workflows/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    params: { cwd, scope },
  })
}

export async function getIdeCatalog(cwd: string, ide: string): Promise<IdeCatalog> {
  return apiFetch<IdeCatalog>(`/ide/${encodeURIComponent(ide)}/catalog`, { params: { cwd } })
}

export async function getHealth(): Promise<HealthReport> {
  return apiFetch<HealthReport>('/health')
}

export async function startRun(req: StartRunRequest): Promise<{ runId: string; slug: string }> {
  return apiFetch<{ runId: string; slug: string }>('/runs', { method: 'POST', body: req })
}

export async function stopRun(id: string): Promise<{ finalStatus: string }> {
  return apiFetch<{ finalStatus: string }>(`/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' })
}

export async function retryStep(id: string): Promise<{ resumedStepId: string }> {
  return apiFetch<{ resumedStepId: string }>(`/runs/${encodeURIComponent(id)}/retry-step`, { method: 'POST' })
}

// Zod validators — minimal schemas reusable by web/src/lib/ws/*

export const RunStatusSchema = z.enum(['running', 'completed', 'failed', 'crashed', 'aborted'])

// The four tool-call lifecycle statuses, mirroring the server `ToolCallStatus`
// (src/domain/runner.ts). A value outside this set fails parse and the event is
// dropped (ADR-003 schema-drift mitigation).
export const ToolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed'])

// Mirrors the server `ToolCallView` (src/domain/runner.ts) field-for-field:
// the precomputed, display-ready view shipped inside a `tool_call` event.
export const ToolCallViewSchema = z.object({
  toolCallId: z.string(),
  status: ToolCallStatusSchema,
  kind: z.string(),
  title: z.string(),
  errorText: z.string().optional(),
})

export const RunnerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('banner'),
    step: z.object({ id: z.string() }),
    index: z.number(),
  }),
  z.object({ type: z.literal('log'), message: z.string(), color: z.string().optional() }),
  z.object({
    type: z.literal('stream'),
    kind: z.string(),
    chunk: z.string(),
    color: z.string().optional(),
  }),
  z.object({ type: z.literal('interactive'), enabled: z.boolean() }),
  z.object({ type: z.literal('status'), text: z.string(), color: z.string().optional() }),
  z.object({ type: z.literal('tool_call'), call: ToolCallViewSchema }),
  z.object({ type: z.literal('summary'), summary: z.unknown() }),
])

export const RunEventSchema = z.object({
  seq: z.number(),
  ts: z.number(),
  stepId: z.string().nullable(),
  event: z.unknown(),
})

const RunDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  workflowPath: z.string(),
  cwd: z.string().optional(),
  // Present only for isolated runs (ADR-004); kept here so the snapshot frame
  // carries them through to the run-detail view (z.object strips unknown keys).
  worktreePath: z.string().optional(),
  branch: z.string().optional(),
  status: RunStatusSchema,
  currentStepId: z.string().nullable(),
  visitedStepIds: z.array(z.string()),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  attachedCount: z.number(),
})

export const AttachFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), snapshot: RunDetailSchema }),
  z.object({
    type: z.literal('backlog'),
    entries: z.array(RunEventSchema),
    truncated: z.boolean(),
  }),
  z.object({ type: z.literal('event'), entry: RunEventSchema }),
  z.object({ type: z.literal('status'), status: RunStatusSchema }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
])
