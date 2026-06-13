import { CircleX } from 'lucide-react'
import { useAttach } from '@/lib/ws/use-attach'
import type { TranscriptItem } from '@/lib/ws/reducer'
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
  const { worktreePath, branch, initialPrompt } = vm.snapshot ?? {}
  const isolated = Boolean(worktreePath || branch)

  // The prompt a run was started with is surfaced as the opening chat entry —
  // the user's first turn — so the web transcript matches the TUI
  // (`Tui.showInitialPrompt`, which injects `> {prompt}` as the leading entry)
  // and a reviewer opening any run sees the request the agent is responding to.
  // Each line is quoted with `> ` so Streamdown renders it as a blockquote,
  // reading as the user's request and visually distinct from agent output.
  // It is prepended at render time rather than in the reducer so it can never
  // interfere with stream coalescing or seq de-duplication; the sentinel
  // seq `-1` cannot collide with real non-negative event-log seqs used as keys.
  const transcript: TranscriptItem[] = initialPrompt
    ? [
        {
          kind: 'message',
          stepId: null,
          text: initialPrompt
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n'),
          seqStart: -1,
          seqEnd: -1,
        },
        ...vm.transcript,
      ]
    : vm.transcript

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
      <Transcript items={transcript} truncated={vm.backlogTruncated} />
      <RunControls runId={runId} status={vm.status} summary={vm.summary} closed={vm.closed} />
      <InputBox enabled={vm.interactiveEnabled && !vm.closed && vm.status === 'running'} onSend={sendInput} />
    </div>
  )
}
