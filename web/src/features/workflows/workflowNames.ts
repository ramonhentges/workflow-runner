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
