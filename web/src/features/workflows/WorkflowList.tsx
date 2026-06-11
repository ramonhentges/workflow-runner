import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Edit, Play, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError, startRun } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'
import { useWorkflowList } from './useWorkflowList'
import { useDeleteWorkflow } from './useWorkflow'
import { workflowBareName, workflowDisplayName } from './workflowNames'
import type { WorkflowItem, WorkflowScope } from '@/lib/api/types'

// Each row shows which scope its workflow belongs to; a global and a project
// workflow may share a name (ADR-003), so the badge is the user-facing
// disambiguator that pairs with the `scope + name` row key.
function scopeLabel(scope: WorkflowScope): string {
  return scope === 'global' ? 'Global' : 'Project'
}

function runActiveDeleteMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409 && error.code === 'WORKFLOW_RUN_ACTIVE') {
    return 'Stop the active run first before deleting this workflow.'
  }
  return error instanceof Error ? error.message : 'Failed to delete workflow.'
}

export function WorkflowList() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [startingKey, setStartingKey] = useState<string | null>(null)
  const [startError, setStartError] = useState('')
  const { data, isLoading, isError } = useWorkflowList()
  const workflows = data?.workflows ?? []

  // Delete routes through the scope-aware hook (task_05); the row supplies its
  // own scope so the correct directory is targeted. UI concerns (confirm reset,
  // error banner) are handled via per-call mutate callbacks.
  const deleteMutation = useDeleteWorkflow()

  const startMutation = useMutation({
    mutationFn: (workflow: WorkflowItem) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return startRun({ workflowPath: workflow.path, cwd: activeCwd.path })
    },
    onMutate: () => {
      setStartError('')
    },
    onSuccess: async data => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] })
      await navigate({ to: '/runs/$runId', params: { runId: data.runId } })
    },
    onError: error => {
      setStartingKey(null)
      setStartError(error instanceof Error ? error.message : 'Failed to start run.')
    },
  })

  if (!activeCwd) {
    return (
      <div data-testid="no-cwd-prompt" className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No active working directory selected.</p>
        <p className="text-sm mt-1">
          Select or add a working directory using the cwd switcher before managing workflows.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Workflows</h2>
        <Button asChild variant="outline" size="sm">
          <Link to="/workflows/new" search={{ from: undefined, scope: 'project' }}>
            <Plus className="size-4" aria-hidden="true" />
            New workflow
          </Link>
        </Button>
      </div>

      {isLoading && (
        <div data-testid="workflows-loading" className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              data-testid="workflow-row-skeleton"
              className="flex items-center gap-4 px-2 py-3"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-56" />
              <Skeleton className="ml-auto h-8 w-48" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div data-testid="workflows-error" className="text-center py-8 text-destructive">
          Failed to load workflows.
        </div>
      )}

      {deleteError && (
        <div
          data-testid="delete-error"
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {deleteError}
        </div>
      )}

      {startError && (
        <div
          data-testid="start-error"
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {startError}
        </div>
      )}

      {!isLoading && !isError && workflows.length === 0 && (
        <div
          data-testid="no-workflows-state"
          className="flex flex-col items-center gap-3 py-12 text-center"
        >
          <p className="font-medium">No workflows yet</p>
          <p className="text-sm text-muted-foreground">
            Create your first workflow to start running it.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link
              to="/workflows/new"
              search={{ from: undefined, scope: 'project' }}
              data-testid="create-first-workflow-action"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create your first workflow
            </Link>
          </Button>
        </div>
      )}

      {!isLoading && !isError && workflows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map(workflow => {
                const bareName = workflowBareName(workflow)
                // Key interaction state by scope+name (matching the row key), not
                // the bare name alone: a global and a project workflow may share a
                // bare name, and a bare-name key would light up the confirm /
                // "Starting…" / "Deleting…" state on both rows at once.
                const rowKey = `${workflow.scope}-${bareName}`
                const isConfirming = confirmingKey === rowKey
                const isDeleting = deleteMutation.isPending && isConfirming
                const isStarting = startMutation.isPending && startingKey === rowKey

                return (
                  <TableRow
                    key={rowKey}
                    data-testid={`workflow-row-${bareName}`}
                  >
                    <TableCell className="font-medium">{workflowDisplayName(workflow)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={workflow.scope === 'global' ? 'secondary' : 'outline'}
                        data-testid="workflow-scope-badge"
                        data-scope={workflow.scope}
                      >
                        {scopeLabel(workflow.scope)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {workflow.path}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isStarting}
                          onClick={() => {
                            setStartingKey(rowKey)
                            startMutation.mutate(workflow)
                          }}
                        >
                          <Play className="size-4" aria-hidden="true" />
                          {isStarting ? 'Starting…' : 'Run'}
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link
                            to="/workflows/$name/edit"
                            params={{ name: bareName }}
                            search={{ scope: workflow.scope }}
                          >
                            <Edit className="size-4" aria-hidden="true" />
                            Edit
                          </Link>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                          <Link
                            to="/workflows/new"
                            search={{ from: bareName, scope: workflow.scope }}
                          >
                            <Copy className="size-4" aria-hidden="true" />
                            Duplicate
                          </Link>
                        </Button>
                        {!isConfirming ? (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setConfirmingKey(rowKey)
                              setDeleteError('')
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Delete
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              disabled={isDeleting}
                              onClick={() => {
                                setDeleteError('')
                                deleteMutation.mutate(
                                  { scope: workflow.scope, name: bareName },
                                  {
                                    onSuccess: () => setConfirmingKey(null),
                                    onError: error => setDeleteError(runActiveDeleteMessage(error)),
                                  },
                                )
                              }}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              {isDeleting ? 'Deleting…' : 'Confirm'}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={isDeleting}
                              onClick={() => setConfirmingKey(null)}
                            >
                              <X className="size-4" aria-hidden="true" />
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
