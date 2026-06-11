import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, Edit, Play, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  // The run dialog is a single controlled instance keyed by the workflow it was
  // opened for; `null` means closed. This is the list's isolation entry point
  // (PRD Core Feature #1), mirroring StartRunForm's branch field.
  const [runDialogWorkflow, setRunDialogWorkflow] = useState<WorkflowItem | null>(null)
  const [branch, setBranch] = useState('')
  const [startError, setStartError] = useState('')
  const { data, isLoading, isError } = useWorkflowList()
  const workflows = data?.workflows ?? []

  // Delete routes through the scope-aware hook (task_05); the row supplies its
  // own scope so the correct directory is targeted. UI concerns (confirm reset,
  // error banner) are handled via per-call mutate callbacks.
  const deleteMutation = useDeleteWorkflow()

  const startMutation = useMutation({
    mutationFn: ({ workflow, branch }: { workflow: WorkflowItem; branch: string }) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      // A non-empty branch opts the run into git-worktree isolation (ADR-001);
      // leaving it blank starts a normal run in the active cwd. Same request
      // shaping as StartRunForm so the non-isolated path is byte-for-byte
      // identical.
      const trimmedBranch = branch.trim()
      return startRun({
        workflowPath: workflow.path,
        cwd: activeCwd.path,
        ...(trimmedBranch ? { branch: trimmedBranch } : {}),
      })
    },
    onMutate: () => {
      setStartError('')
    },
    onSuccess: async data => {
      setRunDialogWorkflow(null)
      await queryClient.invalidateQueries({ queryKey: ['runs'] })
      await navigate({ to: '/runs/$runId', params: { runId: data.runId } })
    },
    onError: error => {
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
                          onClick={() => {
                            setBranch('')
                            setStartError('')
                            setRunDialogWorkflow(workflow)
                          }}
                        >
                          <Play className="size-4" aria-hidden="true" />
                          Run
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

      <Dialog
        open={runDialogWorkflow !== null}
        onOpenChange={open => {
          if (!open) {
            setRunDialogWorkflow(null)
            setBranch('')
            setStartError('')
          }
        }}
      >
        <DialogContent data-testid="run-dialog">
          <DialogHeader>
            <DialogTitle>
              Run {runDialogWorkflow ? workflowDisplayName(runDialogWorkflow) : ''}
            </DialogTitle>
            <DialogDescription>
              Optionally run in an isolated git worktree on a branch.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={e => {
              e.preventDefault()
              if (runDialogWorkflow) {
                startMutation.mutate({ workflow: runDialogWorkflow, branch })
              }
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="run-branch-input">Branch (optional)</Label>
              <Input
                id="run-branch-input"
                value={branch}
                onChange={e => {
                  setBranch(e.target.value)
                  setStartError('')
                }}
                placeholder="feature/my-branch"
              />
              <p className="text-xs text-muted-foreground">
                Run in an isolated git worktree on this branch. Leave blank to run in the working
                directory.
              </p>
            </div>

            {startError && (
              <p data-testid="start-error" role="alert" className="text-sm text-destructive">
                {startError}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={startMutation.isPending}>
                <Play className="size-4" aria-hidden="true" />
                {startMutation.isPending ? 'Starting…' : 'Start run'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
