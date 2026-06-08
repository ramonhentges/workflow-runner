import { Ban, CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RunStatus } from '@/lib/api/types'

export interface StatusBadgeProps {
  status: RunStatus
  /** icon-only (table cell) vs icon+label (cards, banners) */
  showLabel?: boolean
  className?: string
}

interface StatusMeta {
  label: string
  icon: LucideIcon
  /** token class pair, e.g. 'text-status-failed bg-status-failed/10' */
  tone: string
}

// The single source of truth mapping a RunStatus to its presentation.
// Replaces the ad-hoc statusClass() color strings scattered across features.
const STATUS_META: Record<RunStatus, StatusMeta> = {
  running: {
    label: 'Running',
    icon: LoaderCircle,
    tone: 'text-status-running bg-status-running/10',
  },
  completed: {
    label: 'Completed',
    icon: CircleCheck,
    tone: 'text-status-completed bg-status-completed/10',
  },
  failed: {
    label: 'Failed',
    icon: CircleX,
    tone: 'text-status-failed bg-status-failed/10',
  },
  crashed: {
    label: 'Crashed',
    icon: TriangleAlert,
    tone: 'text-status-crashed bg-status-crashed/10',
  },
  aborted: {
    label: 'Aborted',
    icon: Ban,
    tone: 'text-status-aborted bg-status-aborted/10',
  },
}

export function StatusBadge({ status, showLabel = true, className }: StatusBadgeProps) {
  const meta = STATUS_META[status]
  const Icon = meta.icon

  return (
    <Badge
      variant="outline"
      data-status={status}
      // In icon-only mode the visual label is dropped, so name the badge for AT.
      aria-label={showLabel ? undefined : meta.label}
      className={cn(meta.tone, 'border-transparent', !showLabel && 'px-1', className)}
    >
      <Icon aria-hidden="true" className={status === 'running' ? 'animate-spin' : undefined} />
      {showLabel ? <span>{meta.label}</span> : null}
    </Badge>
  )
}
