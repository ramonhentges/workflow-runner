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
      className="flex-1 overflow-y-auto font-mono text-sm p-4 space-y-1 min-h-0"
    >
      {truncated && (
        <div
          data-testid="transcript-truncated-notice"
          className="text-xs text-muted-foreground italic border-b border-border pb-1 mb-1"
        >
          Earlier output was omitted (backlog truncated).
        </div>
      )}
      {items.map((item) => (
        <div key={`${item.seqStart}-${item.kind}`} data-testid="transcript-item" data-kind={item.kind} className={cn(
          'whitespace-pre-wrap break-words',
          item.kind === 'step' && 'text-blue-600 font-semibold border-b border-blue-200 py-1 mt-2',
          item.kind === 'message' && 'text-foreground',
          item.kind === 'log' && 'text-muted-foreground text-xs',
          item.kind === 'status' && 'text-yellow-600 italic',
        )}>
          {item.text}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
