import { useState } from 'react'
import { Link, useSearch } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import { StatusSummaryCards } from './StatusSummaryCards'
import { parseStatus } from '@/lib/api/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCwdStore } from '@/stores/cwd-store'
import { useRuns } from './useRuns'

// Human-readable run duration derived in-view from startedAt/endedAt.
// Unfinished runs (endedAt === null) have no settled duration yet.
function formatDuration(startedAt: number, endedAt: number | null): string {
  if (endedAt === null) return '—'
  const totalSec = Math.max(0, Math.round((endedAt - startedAt) / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function RunsTable() {
  const [allRuns, setAllRuns] = useState(false)
  const activeCwd = useCwdStore(state => state.activeCwd())
  const { data: runs = [], isLoading, isError } = useRuns({ all: allRuns })

  // Active status filter from the URL (ADR-003); applied to the already-polled array.
  const search = useSearch({ strict: false }) as { status?: unknown }
  const activeStatus = parseStatus(search.status)
  const visibleRuns = activeStatus
    ? runs.filter(run => run.status === activeStatus)
    : runs

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
      <StatusSummaryCards all={allRuns} />

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
        <div data-testid="loading-state" className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              data-testid="run-row-skeleton"
              className="flex items-center gap-4 px-2 py-3"
            >
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div data-testid="error-state" className="text-center py-8 text-destructive">
          Failed to load runs.
        </div>
      )}

      {!isLoading && !isError && runs.length === 0 && (
        <div
          data-testid="no-runs-state"
          className="flex flex-col items-center gap-3 py-12 text-center"
        >
          <p className="font-medium">No runs yet</p>
          <p className="text-sm text-muted-foreground">
            Start a run to watch its progress here.
          </p>
          <Link
            to="/start"
            data-testid="start-run-action"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Play className="size-4" aria-hidden="true" />
            Start a run
          </Link>
        </div>
      )}

      {!isLoading && !isError && runs.length > 0 && visibleRuns.length === 0 && (
        <div
          data-testid="no-filtered-runs-state"
          className="text-center py-12 text-muted-foreground"
        >
          <p>No {activeStatus} runs in this working directory.</p>
        </div>
      )}

      {!isLoading && !isError && visibleRuns.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Status</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Current step</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRuns.map(run => (
              <TableRow
                key={run.id}
                data-testid={`run-row-${run.id}`}
                data-status={run.status}
              >
                <TableCell>
                  <StatusBadge status={run.status} showLabel={false} />
                </TableCell>
                <TableCell>
                  <Link
                    to="/runs/$runId"
                    params={{ runId: run.id }}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {run.slug}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {run.workflowPath.split('/').pop() ?? run.workflowPath}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {run.currentStepId ?? '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {formatDuration(run.startedAt, run.endedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
