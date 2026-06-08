import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Card } from '@/components/ui/card'
import { StatusBadge } from './status-badge'
import type { RunStatus } from '@/lib/api/types'

interface Case {
  status: RunStatus
  label: string
  iconClass: string
  toneText: string
  toneBg: string
}

const CASES: Case[] = [
  {
    status: 'running',
    label: 'Running',
    iconClass: 'lucide-loader-circle',
    toneText: 'text-status-running',
    toneBg: 'bg-status-running/10',
  },
  {
    status: 'completed',
    label: 'Completed',
    iconClass: 'lucide-circle-check',
    toneText: 'text-status-completed',
    toneBg: 'bg-status-completed/10',
  },
  {
    status: 'failed',
    label: 'Failed',
    iconClass: 'lucide-circle-x',
    toneText: 'text-status-failed',
    toneBg: 'bg-status-failed/10',
  },
  {
    status: 'crashed',
    label: 'Crashed',
    iconClass: 'lucide-triangle-alert',
    toneText: 'text-status-crashed',
    toneBg: 'bg-status-crashed/10',
  },
  {
    status: 'aborted',
    label: 'Aborted',
    iconClass: 'lucide-ban',
    toneText: 'text-status-aborted',
    toneBg: 'bg-status-aborted/10',
  },
]

function badgeEl(status: RunStatus): HTMLElement {
  const el = document.querySelector(`[data-status="${status}"]`)
  if (!(el instanceof HTMLElement)) throw new Error(`no badge for status ${status}`)
  return el
}

// Unit tests

describe('StatusBadge — per-status presentation (labeled)', () => {
  test.each(CASES)(
    '$status renders its label, icon, and tone classes',
    ({ status, label, iconClass, toneText, toneBg }) => {
      render(<StatusBadge status={status} />)

      const badge = badgeEl(status)
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(badge.querySelector(`.${iconClass}`)).not.toBeNull()
      expect(badge).toHaveClass(toneText, toneBg)
    },
  )
})

describe('StatusBadge — rendering modes', () => {
  test('showLabel={false} renders the icon only and no text label', () => {
    render(<StatusBadge status="running" showLabel={false} />)

    const badge = badgeEl('running')
    expect(badge.querySelector('.lucide-loader-circle')).not.toBeNull()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
    // Still accessible by name for assistive tech.
    expect(badge).toHaveAttribute('aria-label', 'Running')
  })

  test('labeled mode renders both the icon and the visible status text', () => {
    render(<StatusBadge status="failed" showLabel />)

    const badge = badgeEl('failed')
    expect(badge.querySelector('.lucide-circle-x')).not.toBeNull()
    expect(screen.getByText('Failed')).toBeVisible()
  })

  test('defaults to labeled mode when showLabel is omitted', () => {
    render(<StatusBadge status="completed" />)
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })
})

describe('StatusBadge — className merge', () => {
  test('a passed className is merged onto the rendered element', () => {
    render(<StatusBadge status="aborted" className="custom-marker" />)

    const badge = badgeEl('aborted')
    expect(badge).toHaveClass('custom-marker')
    // Tone classes survive the merge alongside the custom class.
    expect(badge).toHaveClass('text-status-aborted')
  })
})

// Integration tests

describe('StatusBadge — within a consumer container (integration)', () => {
  test('all five statuses render without error inside a Card', () => {
    render(
      <Card data-testid="status-list">
        {CASES.map(c => (
          <StatusBadge key={c.status} status={c.status} />
        ))}
      </Card>,
    )

    const container = screen.getByTestId('status-list')
    for (const c of CASES) {
      const badge = container.querySelector(`[data-status="${c.status}"]`)
      expect(badge).not.toBeNull()
      expect(badge?.querySelector(`.${c.iconClass}`)).not.toBeNull()
      expect(screen.getByText(c.label)).toBeInTheDocument()
    }
  })
})
