import { useMutation, useQueryClient } from '@tanstack/react-query'
import { stopRun, retryStep } from '@/lib/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/status-badge'
import type { RunStatus } from '@/lib/api/types'

const TERMINAL_STATUSES: RunStatus[] = ['completed', 'failed', 'crashed', 'aborted']
const RETRYABLE_STATUSES: RunStatus[] = ['failed', 'crashed', 'aborted']

interface RunControlsProps {
  runId: string
  status: RunStatus | null
  summary: unknown | null
  closed?: boolean
}

export function RunControls({ runId, status, summary, closed = false }: RunControlsProps) {
  const queryClient = useQueryClient()

  const stopMutation = useMutation({
    mutationFn: () => stopRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const retryMutation = useMutation({
    mutationFn: () => retryStep(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const canStop = status === 'running'
  const canRetry = status !== null && RETRYABLE_STATUSES.includes(status)
  const isTerminal = status !== null && TERMINAL_STATUSES.includes(status)

  return (
    <div className="flex flex-col gap-2 py-2">
      <div className="flex items-center gap-2 px-4">
        {status !== null && <StatusBadge status={status} />}
        <div className="ml-auto flex gap-2">
          <Button
            data-testid="stop-button"
            variant="destructive"
            size="sm"
            disabled={!canStop || stopMutation.isPending || closed}
            onClick={() => stopMutation.mutate()}
          >
            Stop
          </Button>
          <Button
            data-testid="retry-button"
            variant="outline"
            size="sm"
            disabled={!canRetry || retryMutation.isPending || closed}
            onClick={() => retryMutation.mutate()}
          >
            Retry step
          </Button>
        </div>
      </div>

      {isTerminal && summary !== null && (
        <Card data-testid="summary-panel" className="mx-4 gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm">Run Summary</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <pre className="text-sm whitespace-pre-wrap break-words">
              {typeof summary === 'string'
                ? summary
                : JSON.stringify(summary, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {stopMutation.isError && (
        <p data-testid="stop-error" className="px-4 text-sm text-destructive">
          {stopMutation.error instanceof Error
            ? stopMutation.error.message
            : 'Failed to stop run.'}
        </p>
      )}

      {retryMutation.isError && (
        <p data-testid="retry-error" className="px-4 text-sm text-destructive">
          {retryMutation.error instanceof Error
            ? retryMutation.error.message
            : 'Failed to retry step.'}
        </p>
      )}
    </div>
  )
}
