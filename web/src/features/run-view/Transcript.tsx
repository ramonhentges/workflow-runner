import { Circle, CircleCheck, CircleX, LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Streamdown } from 'streamdown'
import { code } from '@streamdown/code'
import { cn } from '@/lib/utils'
import type { ToolCallStatus } from '@/lib/api/types'
import type { TranscriptItem } from '@/lib/ws/reducer'

interface TranscriptProps {
  items: TranscriptItem[]
  truncated?: boolean
}

// Status affordance for a folded tool-call row. The spinner animates via the
// CSS-only `animate-spin` utility (no JS timer) and settles to a terminal glyph
// the moment status leaves `in_progress`.
function ToolCallStatusIcon({ status }: { status: ToolCallStatus }) {
  const base = 'size-3.5 shrink-0'
  switch (status) {
    case 'in_progress':
      return (
        <LoaderCircle
          data-testid="tool-call-spinner"
          aria-label="in progress"
          className={cn(base, 'animate-spin text-status-running')}
        />
      )
    case 'completed':
      return (
        <CircleCheck
          data-testid="tool-call-icon"
          aria-label="completed"
          className={cn(base, 'text-status-completed')}
        />
      )
    case 'failed':
      return (
        <CircleX
          data-testid="tool-call-icon"
          aria-label="failed"
          className={cn(base, 'text-status-failed')}
        />
      )
    case 'pending':
    default:
      return (
        <Circle
          data-testid="tool-call-icon"
          aria-label="pending"
          className={cn(base, 'text-muted-foreground')}
        />
      )
  }
}

// Agent/user chat messages carry markdown (headings, lists, code, tables). Render
// them through Streamdown — it tolerates the incomplete markdown that arrives mid-
// stream — styled with the typography `prose` classes so the output follows the
// active light/dark color mode via `dark:prose-invert`. `font-sans` resets the
// transcript container's `font-mono` so prose body text reads normally while code
// spans/blocks stay monospace; `max-w-none` lets messages use the full panel width.
// The `code` plugin syntax-highlights fenced blocks via Shiki, with a light/dark
// theme pair so highlighting tracks the active color mode alongside `dark:prose-invert`.
function MessageItem({ item }: { item: TranscriptItem }) {
  return (
    <div
      data-testid="transcript-item"
      data-kind="message"
      className="text-foreground"
    >
      <Streamdown
        plugins={{ code }}
        shikiTheme={['github-light', 'github-dark']}
        className="prose prose-sm dark:prose-invert max-w-none font-sans break-words"
      >
        {item.text}
      </Streamdown>
    </div>
  )
}

function ToolCallRow({ item }: { item: TranscriptItem }) {
  const status = item.status ?? 'pending'
  return (
    <div
      data-testid="transcript-item"
      data-kind="tool_call"
      data-status={status}
      className="flex items-center gap-2 text-foreground"
    >
      <ToolCallStatusIcon status={status} />
      <span className="break-words">
        {item.text}
        {item.errorText ? (
          <span className="text-status-failed"> — {item.errorText}</span>
        ) : null}
      </span>
    </div>
  )
}

export function Transcript({ items, truncated }: TranscriptProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (distanceFromBottom < 100) {
      endRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [items])

  return (
    <div
      ref={containerRef}
      data-testid="transcript"
      className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-muted/20 p-4 font-mono text-sm"
    >
      {truncated && (
        <div
          data-testid="transcript-truncated-notice"
          className="mb-1 border-b border-border pb-1 text-xs italic text-muted-foreground"
        >
          Earlier output was omitted (backlog truncated).
        </div>
      )}
      {items.map((item) =>
        // Tool-call rows are keyed by their reducer fold identity — the
        // (stepId, toolCallId) pair — so live status updates mutate the existing
        // row in place, while the same toolCallId re-seen in a later step (some
        // adapters restart ids per step) stays a distinct row instead of
        // colliding on a duplicate React key.
        item.kind === 'tool_call' ? (
          <ToolCallRow key={`tool-${item.stepId ?? ''}-${item.toolCallId}`} item={item} />
        ) : item.kind === 'message' ? (
          <MessageItem key={`${item.seqStart}-message`} item={item} />
        ) : (
          <div
            key={`${item.seqStart}-${item.kind}`}
            data-testid="transcript-item"
            data-kind={item.kind}
            className={cn(
              'whitespace-pre-wrap break-words',
              item.kind === 'step' && 'mt-2 border-b border-border py-1 font-semibold text-primary',
              item.kind === 'log' && 'text-xs text-muted-foreground',
              item.kind === 'status' && 'italic text-status-running',
            )}
          >
            {item.text}
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}
