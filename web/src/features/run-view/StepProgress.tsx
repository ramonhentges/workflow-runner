import { cn } from '@/lib/utils'

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
    <div data-testid="step-progress" className="flex items-center gap-1 px-4 py-2 border-b overflow-x-auto">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span className="text-muted-foreground text-xs">›</span>}
          <span
            data-testid={`step-indicator-${step.id}`}
            data-active={step.active}
            className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              step.active
                ? 'bg-primary text-primary-foreground font-semibold'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {step.id}
          </span>
        </div>
      ))}
    </div>
  )
}
