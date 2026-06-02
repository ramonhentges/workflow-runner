import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useCwdStore } from '@/stores/cwd-store'
import { useRuns } from './useRuns'
import type { RunStatus } from '@/lib/api/types'

function statusClass(status: RunStatus): string {
  switch (status) {
    case 'running':
      return 'text-blue-600 font-medium'
    case 'completed':
      return 'text-green-600'
    case 'failed':
      return 'text-red-600 font-medium'
    case 'crashed':
      return 'text-orange-500'
    case 'aborted':
      return 'text-gray-400'
  }
}

export function RunsTable() {
  const [allRuns, setAllRuns] = useState(false)
  const activeCwd = useCwdStore(state => state.activeCwd())
  const { data: runs = [], isLoading, isError } = useRuns({ all: allRuns })

  if (!activeCwd) {
    return (
      <div data-testid="no-cwd-state" className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No active working directory configured.</p>
        <p className="text-sm mt-1">Add a working directory using the cwd switcher.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Runs</h2>
        <Button
          variant={allRuns ? 'default' : 'outline'}
          size="sm"
          onClick={() => setAllRuns(v => !v)}
          aria-pressed={allRuns}
        >
          All runs
        </Button>
      </div>

      {isLoading && (
        <div data-testid="loading-state" className="text-center py-8 text-muted-foreground">
          Loading…
        </div>
      )}

      {isError && (
        <div data-testid="error-state" className="text-center py-8 text-destructive">
          Failed to load runs.
        </div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <div data-testid="no-runs-state" className="text-center py-12 text-muted-foreground">
          <p>No runs found for this working directory.</p>
        </div>
      )}

      {!isLoading && !isError && runs.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">Slug</th>
              <th className="pb-2 pr-4 font-medium">Workflow</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Current step</th>
              <th className="pb-2 pr-4 font-medium">Started</th>
              <th className="pb-2 pr-4 font-medium">Ended</th>
              <th className="pb-2 font-medium">Attached</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr
                key={run.id}
                data-testid={`run-row-${run.id}`}
                data-status={run.status}
                className="border-b hover:bg-accent/50 transition-colors"
              >
                <td className="py-2 pr-4">
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    className="font-mono text-xs hover:underline"
                  >
                    {run.slug}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {run.workflowPath.split('/').pop() ?? run.workflowPath}
                </td>
                <td className={cn('py-2 pr-4', statusClass(run.status))}>{run.status}</td>
                <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                  {run.currentStepId ?? '—'}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-muted-foreground">
                  {run.endedAt !== null ? new Date(run.endedAt).toLocaleString() : '—'}
                </td>
                <td className="py-2 text-muted-foreground">{run.attachedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
