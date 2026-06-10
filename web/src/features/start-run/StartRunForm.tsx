import { useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCwdStore } from '@/stores/cwd-store'
import { startRun } from '@/lib/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkflowScope } from '@/lib/api/types'
import { useWorkflows } from './useWorkflows'

// The picker merges global and project workflows (ADR-001); a global and a
// project workflow can share a name, so each option carries a scope badge as the
// user-facing disambiguator. Selecting a global item still starts a run against
// the active cwd — the start contract is unchanged.
function scopeLabel(scope: WorkflowScope): string {
  return scope === 'global' ? 'Global' : 'Project'
}

export function StartRunForm() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedPath, setSelectedPath] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [validationError, setValidationError] = useState('')

  const { data: workflowsData, isLoading: workflowsLoading, isError: workflowsError } = useWorkflows()
  const workflows = workflowsData?.workflows ?? []

  const mutation = useMutation({
    mutationFn: (req: { workflowPath: string; cwd: string }) => startRun(req),
    onSuccess: async data => {
      await queryClient.invalidateQueries({ queryKey: ['runs'] })
      await navigate({ to: '/runs/$runId', params: { runId: data.runId } })
    },
  })

  if (!activeCwd) {
    return (
      <div data-testid="no-cwd-prompt" className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No active working directory selected.</p>
        <p className="text-sm mt-1">
          Select or add a working directory using the cwd switcher before starting a run.
        </p>
      </div>
    )
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setValidationError('')

    const workflowPath = selectedPath || manualPath.trim()
    if (!workflowPath) {
      setValidationError('Please select a workflow or enter a workflow path.')
      return
    }

    mutation.mutate({ workflowPath, cwd: activeCwd!.path })
  }

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Start a Run</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {workflowsLoading && (
            <p data-testid="workflows-loading" className="text-sm text-muted-foreground">
              Loading workflows…
            </p>
          )}

          {workflowsError && (
            <p data-testid="workflows-error" className="text-sm text-destructive">
              Could not load workflows — enter a path manually.
            </p>
          )}

          {workflows.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="workflow-select">Workflow</Label>
              <Select
                value={selectedPath}
                onValueChange={value => {
                  setSelectedPath(value)
                  setManualPath('')
                  setValidationError('')
                }}
              >
                <SelectTrigger id="workflow-select" className="w-full">
                  <SelectValue placeholder="— select a workflow —" />
                </SelectTrigger>
                <SelectContent>
                  {workflows.map(wf => (
                    <SelectItem key={wf.path} value={wf.path}>
                      <span className="flex items-center gap-2">
                        <span>{wf.name}</span>
                        <Badge
                          variant={wf.scope === 'global' ? 'secondary' : 'outline'}
                          data-testid="workflow-scope-badge"
                          data-scope={wf.scope}
                        >
                          {scopeLabel(wf.scope)}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="manual-path-input">
              {workflows.length > 0 ? 'Or enter a path manually' : 'Workflow path'}
            </Label>
            <Input
              id="manual-path-input"
              value={manualPath}
              onChange={e => {
                setManualPath(e.target.value)
                setSelectedPath('')
                setValidationError('')
              }}
              placeholder="/path/to/workflow.json"
            />
          </div>

          {validationError && (
            <p data-testid="validation-error" className="text-sm text-destructive">
              {validationError}
            </p>
          )}

          {mutation.isError && (
            <p data-testid="submit-error" className="text-sm text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to start run.'}
            </p>
          )}

          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Starting…' : 'Start run'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
