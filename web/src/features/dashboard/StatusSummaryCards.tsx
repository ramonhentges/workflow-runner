import { useNavigate, useSearch } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import { cn } from '@/lib/utils'
import { RUN_STATUSES, parseStatus, type RunStatus } from '@/lib/api/types'
import { useRuns } from './useRuns'

// One skeleton placeholder per status, shaped to match the loaded card (badge row + count).
function StatusCardsSkeleton() {
  return (
    <div
      data-testid="status-cards-skeleton"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {RUN_STATUSES.map(status => (
        <Card key={status} className="p-0">
          <div className="flex flex-col items-start gap-2 p-4">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-8 w-10" />
          </div>
        </Card>
      ))}
    </div>
  )
}

function zeroCounts(): Record<RunStatus, number> {
  return { running: 0, completed: 0, failed: 0, crashed: 0, aborted: 0 }
}

// Five status summary cards derived client-side from the existing runs poll (ADR-002).
// Clicking a card toggles the `?status=` filter on the index route (ADR-003); no new fetch.
// `all` mirrors the table's "All runs" scope so counts and rows derive from one dataset
// (same query key); without it the cards always query `all:false` and diverge from the list.
export function StatusSummaryCards({ all = false }: { all?: boolean }) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { status?: unknown }
  const activeStatus = parseStatus(search.status)
  const { data: runs = [], isLoading } = useRuns({ all })

  // First load: show layout-matched skeleton cards instead of a flash of zeros.
  if (isLoading) return <StatusCardsSkeleton />

  const counts = runs.reduce<Record<RunStatus, number>>((acc, run) => {
    acc[run.status]++
    return acc
  }, zeroCounts())

  function toggle(status: RunStatus) {
    // Re-clicking the active card clears the filter.
    navigate({ to: '/', search: { status: activeStatus === status ? undefined : status } })
  }

  return (
    <div
      data-testid="status-summary-cards"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
    >
      {RUN_STATUSES.map(status => {
        const count = counts[status]
        const isActive = activeStatus === status
        // The Failed card is emphasized whenever there is at least one failure to triage.
        const emphasized = status === 'failed' && count > 0
        return (
          <Card
            key={status}
            className={cn('p-0 transition-colors', isActive && 'ring-2 ring-ring')}
          >
            <button
              type="button"
              data-testid={`status-card-${status}`}
              data-status={status}
              data-emphasized={emphasized}
              aria-pressed={isActive}
              onClick={() => toggle(status)}
              className={cn(
                'flex w-full cursor-pointer flex-col items-start gap-2 rounded-xl p-4 text-left transition-colors hover:bg-accent/50',
                emphasized && 'bg-status-failed/10',
              )}
            >
              <StatusBadge status={status} />
              <span className="text-2xl font-semibold tabular-nums">{count}</span>
            </button>
          </Card>
        )
      })}
    </div>
  )
}
