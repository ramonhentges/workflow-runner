import { useFieldArray, useFormContext, useWatch } from 'react-hook-form'
import type { Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkflowDraft } from './WorkflowDraftSchema'

interface EdgesFieldProps {
  stepIndex: number
  control: Control<WorkflowDraft>
}

export function EdgesField({ stepIndex, control }: EdgesFieldProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<WorkflowDraft>()

  const { fields, append, remove } = useFieldArray({
    control,
    name: `steps.${stepIndex}.edges` as const,
  })

  // A handoff edge can only ever point at an existing step id (enforced by both
  // the web schema and the domain), so the valid `next_step` values are exactly
  // the sibling step ids. Watch the live step list and offer them as options
  // instead of free text, excluding this step's own id to discourage trivial
  // self-loops.
  const steps = useWatch({ control, name: 'steps' })
  const targetStepIds = (steps ?? [])
    .map((s, i) => ({ id: s?.id, index: i }))
    .filter(s => typeof s.id === 'string' && s.id !== '' && s.index !== stepIndex)
    .map(s => s.id as string)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Edges
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ next_step: '', intent: '' })}
          data-testid={`add-edge-button-${stepIndex}`}
        >
          Add edge
        </Button>
      </div>

      {fields.map((field, edgeIndex) => {
        const edgeErrors = errors.steps?.[stepIndex]?.edges?.[edgeIndex]
        const currentNext = steps?.[stepIndex]?.edges?.[edgeIndex]?.next_step
        // Keep a value that no longer matches any sibling step (a dangling
        // reference after a rename/removal, or a pre-existing self-loop)
        // selectable, so editing doesn't silently drop it and validation can
        // still flag it.
        const isDangling =
          typeof currentNext === 'string' &&
          currentNext !== '' &&
          !targetStepIds.includes(currentNext)
        return (
          <div
            key={field.id}
            data-testid={`edge-row-${stepIndex}-${edgeIndex}`}
            className="flex gap-2 items-start border rounded p-2 bg-muted/20"
          >
            <div className="flex-1 flex flex-col gap-1">
              <Label htmlFor={`edge-next-${stepIndex}-${edgeIndex}`}>
                Next step ID
              </Label>
              <select
                id={`edge-next-${stepIndex}-${edgeIndex}`}
                {...register(`steps.${stepIndex}.edges.${edgeIndex}.next_step`)}
                className="border rounded px-3 py-2 text-sm bg-background"
                data-testid={`edge-next-step-input-${stepIndex}-${edgeIndex}`}
              >
                <option value="">Select a step</option>
                {isDangling && (
                  <option value={currentNext}>{currentNext} (missing)</option>
                )}
                {targetStepIds.map(id => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              {edgeErrors?.next_step && (
                <p
                  className="text-xs text-destructive"
                  data-testid={`edge-next-step-error-${stepIndex}-${edgeIndex}`}
                >
                  {edgeErrors.next_step.message}
                </p>
              )}
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <Label htmlFor={`edge-intent-${stepIndex}-${edgeIndex}`}>
                Intent
              </Label>
              <Input
                id={`edge-intent-${stepIndex}-${edgeIndex}`}
                {...register(`steps.${stepIndex}.edges.${edgeIndex}.intent`)}
                placeholder="handoff intent description"
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-6"
              onClick={() => remove(edgeIndex)}
              data-testid={`remove-edge-button-${stepIndex}-${edgeIndex}`}
              aria-label="Remove edge"
            >
              ✕
            </Button>
          </div>
        )
      })}
    </div>
  )
}
