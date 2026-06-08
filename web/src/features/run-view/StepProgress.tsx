import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface Step {
  id: string
  index: number
  active: boolean
}

interface StepProgressProps {
  steps: Step[]
}

export function StepProgress({ steps }: StepProgressProps) {
  if (steps.length === 0) return null

  return (
    <div
      data-testid="step-progress"
      className="flex items-center gap-1 overflow-x-auto border-b px-4 py-2"
    >
      {steps.map((step, i) => (
        <div key={step.id} className="flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden="true" className="size-3 text-muted-foreground" />}
          <Badge
            data-testid={`step-indicator-${step.id}`}
            data-active={step.active}
            variant={step.active ? 'default' : 'secondary'}
          >
            {step.id}
          </Badge>
        </div>
      ))}
    </div>
  )
}
