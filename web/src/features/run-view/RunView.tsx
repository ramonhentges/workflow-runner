import { useAttach } from '@/lib/ws/use-attach'
import { Transcript } from './Transcript'
import { StepProgress } from './StepProgress'
import { InputBox } from './InputBox'
import { RunControls } from './RunControls'

interface RunViewProps {
  runId: string
}

export function RunView({ runId }: RunViewProps) {
  const { vm, sendInput } = useAttach(runId)

  return (
    <div data-testid="run-view" className="flex flex-col h-full min-h-0">
      {vm.error && (
        <div
          data-testid="socket-error-notice"
          role="alert"
          className="px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20"
        >
          Socket error: {vm.error.code} — {vm.error.message}
        </div>
      )}
      {vm.closed && (
        <div
          data-testid="socket-closed-notice"
          role="status"
          className="px-4 py-2 text-sm bg-muted text-muted-foreground border-b"
        >
          Connection closed.
        </div>
      )}
      <StepProgress steps={vm.steps} />
      <Transcript items={vm.transcript} truncated={vm.backlogTruncated} />
      <RunControls runId={runId} status={vm.status} summary={vm.summary} closed={vm.closed} />
      <InputBox enabled={vm.interactiveEnabled && !vm.closed && vm.status === 'running'} onSend={sendInput} />
    </div>
  )
}
