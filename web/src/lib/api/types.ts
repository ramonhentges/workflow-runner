// Wire types mirroring src/app/api/schema.ts and src/domain/runner.ts.
// Do not import from the runner package — types are redeclared here per ADR-005.

export type RunStatus = 'running' | 'completed' | 'failed' | 'crashed' | 'aborted'

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

export interface HealthReport {
  status: 'ok'
  pid: number
  uptimeMs: number
  activeRuns: number
  version: string
}
