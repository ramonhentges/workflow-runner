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

  return (
    <div data-testid="run-view" className="flex h-full min-h-0 flex-col">
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
