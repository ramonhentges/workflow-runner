// Wire types mirroring src/app/api/schema.ts and src/domain/runner.ts.
// Do not import from the runner package — types are redeclared here per ADR-005.

// The five run statuses, in display order. Single source of truth for the
// RunStatus union, the summary-card grid, and the dashboard `status` filter param.
export const RUN_STATUSES = ['running', 'completed', 'failed', 'crashed', 'aborted'] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

// Whitelist parser for the dashboard `?status=` search param (ADR-003):
// any value outside the five known statuses coerces to "no filter".
export function parseStatus(value: unknown): RunStatus | undefined {
  return (RUN_STATUSES as readonly string[]).includes(value as string)
    ? (value as RunStatus)
    : undefined
}

export type RunnerEvent =
  | { type: 'banner'; step: { id: string }; index: number }
  | { type: 'log'; message: string; color?: string }
  | { type: 'stream'; kind: string; chunk: string; color?: string }
  | { type: 'interactive'; enabled: boolean }
  | { type: 'status'; text: string; color?: string }
  | { type: 'summary'; summary: unknown }

export interface RunEvent {
  seq: number
  ts: number
  stepId: string | null
  event: RunnerEvent
}

export interface RunSummary {
  id: string
  slug: string
  workflowPath: string
  cwd?: string
  currentStepId: string | null
  status: RunStatus
  startedAt: number
  endedAt: number | null
  attachedCount: number
}

export interface RunDetail {
  id: string
  slug: string
  workflowPath: string
  cwd?: string
  status: RunStatus
  currentStepId: string | null
  visitedStepIds: string[]
  startedAt: number
  endedAt: number | null
  attachedCount: number
}

export type AttachFrame =
  | { type: 'snapshot'; snapshot: RunDetail }
  | { type: 'backlog'; entries: RunEvent[]; truncated: boolean }
  | { type: 'event'; entry: RunEvent }
  | { type: 'status'; status: RunStatus }
  | { type: 'error'; code: string; message: string }

export interface InputFrame {
  type: 'input'
  message: string
}

export interface StartRunRequest {
  workflowPath: string
  cwd: string
}

export interface WorkflowItem {
  name: string
  path: string
}

export interface WorkflowList {
  workflows: WorkflowItem[]
}

export interface WorkflowDoc {
  name: string
  path: string
  workflow: unknown
}

export interface WorkflowCreateBody {
  name: string
  workflow: unknown
}

export interface WorkflowUpdateBody {
  name?: string
  workflow: unknown
}

export interface WorkflowDeleteResult {
  deleted: string
}

export interface IdeCatalogEntry {
  id: string
  name: string
}

export interface IdeCatalog {
  reachable: boolean
  agents: IdeCatalogEntry[]
  models: IdeCatalogEntry[]
  reason?: string
}

export interface HealthReport {
  status: 'ok'
  pid: number
  uptimeMs: number
  activeRuns: number
  version: string
}
