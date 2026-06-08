import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { TranscriptItem } from '@/lib/ws/reducer'

interface TranscriptProps {
  items: TranscriptItem[]
  truncated?: boolean
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
      {items.map((item) => (
        <div key={`${item.seqStart}-${item.kind}`} data-testid="transcript-item" data-kind={item.kind} className={cn(
          'whitespace-pre-wrap break-words',
          item.kind === 'step' && 'mt-2 border-b border-border py-1 font-semibold text-primary',
          item.kind === 'message' && 'text-foreground',
          item.kind === 'log' && 'text-xs text-muted-foreground',
          item.kind === 'status' && 'italic text-status-running',
        )}>
          {item.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
