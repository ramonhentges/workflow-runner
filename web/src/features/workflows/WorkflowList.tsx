import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Edit, Play, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ApiError, deleteWorkflow, startRun } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'
import { useWorkflowList, workflowListQueryKey } from './useWorkflowList'
import { workflowBareName, workflowDisplayName } from './workflowNames'
import type { WorkflowItem } from '@/lib/api/types'

const actionLinkClass =
  'inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

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
  const [confirmingName, setConfirmingName] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [startingName, setStartingName] = useState<string | null>(null)
  const [startError, setStartError] = useState('')
  const { data, isLoading, isError } = useWorkflowList()
  const workflows = data?.workflows ?? []

  const deleteMutation = useMutation({
    mutationFn: (workflow: WorkflowItem) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return deleteWorkflow(activeCwd.path, workflowBareName(workflow))
    },
    onMutate: () => {
      setDeleteError('')
    },
    onSuccess: async () => {
      setConfirmingName(null)
      await queryClient.invalidateQueries({
        queryKey: workflowListQueryKey(activeCwd?.path ?? null),
      })
    },
    onError: error => {
      setDeleteError(runActiveDeleteMessage(error))
    },
  })

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
      setStartingName(null)
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
        <Link to="/workflows/new" search={{ from: undefined }} className={actionLinkClass}>
          <Plus className="size-4" aria-hidden="true" />
          New workflow
        </Link>
      </div>

      {isLoading && (
        <div data-testid="workflows-loading" className="text-center py-8 text-muted-foreground">
          Loading workflows…
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
        <div data-testid="no-workflows-state" className="text-center py-12 text-muted-foreground">
          <p>No workflows found for this working directory.</p>
        </div>
      )}

      {!isLoading && !isError && workflows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Workflow</th>
              <th className="pb-2 pr-4 font-medium">File</th>
              <th className="pb-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {workflows.map(workflow => {
              const bareName = workflowBareName(workflow)
              const isConfirming = confirmingName === bareName
              const isDeleting = deleteMutation.isPending && isConfirming
              const isStarting = startMutation.isPending && startingName === bareName

              return (
                <tr
                  key={workflow.path}
                  data-testid={`workflow-row-${bareName}`}
                  className="border-b hover:bg-accent/50 transition-colors"
                >
                  <td className="py-2 pr-4 font-medium">{workflowDisplayName(workflow)}</td>
                  <td className="py-2 pr-4 text-muted-foreground font-mono text-xs">
                    {workflow.path}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isStarting}
                        onClick={() => {
                          setStartingName(bareName)
                          startMutation.mutate(workflow)
                        }}
                      >
                        <Play className="size-4" aria-hidden="true" />
                        {isStarting ? 'Starting…' : 'Run'}
                      </Button>
                      <Link
                        to="/workflows/$name/edit"
                        params={{ name: bareName }}
                        className={actionLinkClass}
                      >
                        <Edit className="size-4" aria-hidden="true" />
                        Edit
                      </Link>
                      <Link
                        to="/workflows/new"
                        search={{ from: bareName }}
                        className={actionLinkClass}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                        Duplicate
                      </Link>
                      {!isConfirming ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            setConfirmingName(bareName)
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
                            onClick={() => deleteMutation.mutate(workflow)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            {isDeleting ? 'Deleting…' : 'Confirm'}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => setConfirmingName(null)}
                          >
                            <X className="size-4" aria-hidden="true" />
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
