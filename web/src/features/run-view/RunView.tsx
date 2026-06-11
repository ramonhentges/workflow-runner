import { CircleX } from 'lucide-react'
import { useAttach } from '@/lib/ws/use-attach'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Transcript } from './Transcript'
import { StepProgress } from './StepProgress'
import { InputBox } from './InputBox'
import { RunControls } from './RunControls'

interface RunViewProps {
  runId: string
}

export function RunView({ runId }: RunViewProps) {
  const { vm, sendInput } = useAttach(runId)

  // Isolated runs (ADR-004) carry a worktree path + branch on the snapshot;
  // non-isolated runs leave both unset and render nothing extra.
  const { worktreePath, branch } = vm.snapshot ?? {}
  const isolated = Boolean(worktreePath || branch)

  return (
    <div data-testid="run-view" className="flex h-full min-h-0 flex-col">
      {isolated && (
        <div
          data-testid="isolation-info"
          className="flex flex-wrap gap-x-6 gap-y-1 border-b px-4 py-2 text-sm text-muted-foreground"
        >
          {branch && (
            <span>
              Branch: <span data-testid="isolation-branch" className="font-mono text-foreground">{branch}</span>
            </span>
          )}
          {worktreePath && (
            <span>
              Worktree:{' '}
              <span data-testid="isolation-worktree" className="font-mono text-foreground">
                {worktreePath}
              </span>
            </span>
          )}
        </div>
      )}
      {vm.error && (
        <Alert
          data-testid="socket-error-notice"
          variant="destructive"
          className="rounded-none border-x-0 border-t-0"
        >
          <CircleX />
          <AlertTitle>Socket error: {vm.error.code}</AlertTitle>
          <AlertDescription>{vm.error.message}</AlertDescription>
        </Alert>
      )}
      {vm.closed && (
        <Alert
          data-testid="socket-closed-notice"
          role="status"
          className="rounded-none border-x-0 border-t-0 text-muted-foreground"
        >
          <AlertTitle>Connection closed.</AlertTitle>
        </Alert>
      )}
      <StepProgress steps={vm.steps} />
      <Transcript items={vm.transcript} truncated={vm.backlogTruncated} />
      <RunControls runId={runId} status={vm.status} summary={vm.summary} closed={vm.closed} />
      <InputBox enabled={vm.interactiveEnabled && !vm.closed && vm.status === 'running'} onSend={sendInput} />
    </div>
  )
}
