import type { WorkflowItem } from '@/lib/api/types'

export function workflowFileName(workflow: WorkflowItem): string {
  return workflow.name || workflow.path.split('/').pop() || workflow.path
}

export function workflowBareName(workflow: WorkflowItem): string {
  const fileName = workflowFileName(workflow)
  return fileName.endsWith('.json') ? fileName.slice(0, -'.json'.length) : fileName
}

export function workflowDisplayName(workflow: WorkflowItem): string {
  return workflowBareName(workflow)
}

// Orders workflows alphabetically by display name, case-insensitively. A global
// and a project workflow may share a name (ADR-003), so scope is a stable
// tiebreaker. Mirrors the cwd switcher's localeCompare idiom.
export function compareWorkflowsByName(a: WorkflowItem, b: WorkflowItem): number {
  const byName = workflowDisplayName(a).localeCompare(
    workflowDisplayName(b),
    undefined,
    { sensitivity: 'base' },
  )
  return byName !== 0 ? byName : a.scope.localeCompare(b.scope)
}
