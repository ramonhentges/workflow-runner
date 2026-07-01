import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const DEFAULT_ENTRY = '__workflow_default_entry__'

const WorkflowStepsSchema = z.object({
  steps: z.array(z.object({ id: z.string().min(1) })).min(1),
})

interface StartStepFieldProps {
  mode: 'catalog' | 'manual'
  value: string
  onValueChange: (value: string) => void
  workflow?: unknown
  isLoading?: boolean
  isError?: boolean
}

export function StartStepField({
  mode,
  value,
  onValueChange,
  workflow,
  isLoading = false,
  isError = false,
}: StartStepFieldProps) {
  if (mode === 'manual') {
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor="start-step-input">Start step (optional)</Label>
        <Input
          id="start-step-input"
          value={value}
          onChange={event => onValueChange(event.target.value)}
          placeholder="e.g. review"
        />
        <p className="text-xs text-muted-foreground">
          Enter an exact, case-sensitive step ID. Leave blank to use the first step.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workflow steps…</p>
  }

  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load workflow steps. The run will start at the first step.
      </p>
    )
  }

  const parsed = WorkflowStepsSchema.safeParse(workflow)
  if (!parsed.success) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Workflow steps are unavailable. The run will start at the first step.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="start-step-select">Start step (optional)</Label>
      <Select
        value={value || DEFAULT_ENTRY}
        onValueChange={next => onValueChange(next === DEFAULT_ENTRY ? '' : next)}
      >
        <SelectTrigger id="start-step-select" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_ENTRY}>Default (first step)</SelectItem>
          {parsed.data.steps.map(step => (
            <SelectItem key={step.id} value={step.id}>
              {step.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
