import { useFormContext, useWatch, Controller } from 'react-hook-form'
import type { Control } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { WorkflowDraft } from './WorkflowDraftSchema'
import { EdgesField } from './EdgesField'
import { AgentModelPicker } from './AgentModelPicker'
import { useIdeCatalog } from './useIdeCatalog'
import { writeLastIde } from './lastIde'

const SUPPORTED_IDES = ['opencode', 'claude-code', 'codex', 'gemini'] as const

interface StepFieldsProps {
  stepIndex: number
  totalSteps: number
  control: Control<WorkflowDraft>
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function StepFields({
  stepIndex,
  totalSteps,
  control,
  onRemove,
  onMoveUp,
  onMoveDown,
}: StepFieldsProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<WorkflowDraft>()

  const stepErrors = errors.steps?.[stepIndex]

  const currentIde = useWatch({ control, name: `steps.${stepIndex}.ide` })
  const { data: catalog, isFetching: catalogFetching } = useIdeCatalog(currentIde)

  // A loaded workflow may carry an `ide` outside the four built-in profiles
  // (the domain layer accepts any non-empty string). The Select has no matching
  // SelectItem for such a value, so render an extra "custom" item to faithfully
  // show and round-trip the persisted ide instead of silently displaying — and
  // on edit, overwriting it with — a built-in.
  const hasCustomIde =
    typeof currentIde === 'string' &&
    currentIde !== '' &&
    !SUPPORTED_IDES.includes(currentIde as (typeof SUPPORTED_IDES)[number])

  const agentEntries = catalog?.agents ?? []
  const modelEntries = catalog?.models ?? []
  const isReachable = catalog?.reachable

  return (
    <div
      data-testid={`step-row-${stepIndex}`}
      className="border rounded-lg p-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Step {stepIndex + 1}</span>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stepIndex === 0}
            onClick={onMoveUp}
            data-testid={`move-step-up-${stepIndex}`}
            aria-label="Move step up"
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={stepIndex === totalSteps - 1}
            onClick={onMoveDown}
            data-testid={`move-step-down-${stepIndex}`}
            aria-label="Move step down"
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onRemove}
            data-testid={`remove-step-button-${stepIndex}`}
            aria-label="Remove step"
          >
            Remove
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-id-${stepIndex}`}>Step ID</Label>
          <Input
            id={`step-id-${stepIndex}`}
            {...register(`steps.${stepIndex}.id`)}
            placeholder="step-1"
            data-testid={`step-id-input-${stepIndex}`}
          />
          {stepErrors?.id && (
            <p
              className="text-xs text-destructive"
              data-testid={`step-id-error-${stepIndex}`}
            >
              {stepErrors.id.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-ide-${stepIndex}`}>IDE</Label>
          <Controller
            name={`steps.${stepIndex}.ide`}
            control={control}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={value => {
                  writeLastIde(value)
                  field.onChange(value)
                }}
              >
                <SelectTrigger
                  id={`step-ide-${stepIndex}`}
                  className="w-full"
                  data-testid={`step-ide-select-${stepIndex}`}
                >
                  <SelectValue placeholder="Select an IDE" />
                </SelectTrigger>
                <SelectContent>
                  {hasCustomIde && (
                    <SelectItem value={currentIde as string}>
                      {currentIde} (custom)
                    </SelectItem>
                  )}
                  {SUPPORTED_IDES.map(ide => (
                    <SelectItem key={ide} value={ide}>
                      {ide}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {stepErrors?.ide && (
            <p className="text-xs text-destructive">{stepErrors.ide.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-mode-${stepIndex}`}>Mode</Label>
          <Controller
            name={`steps.${stepIndex}.mode`}
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={`step-mode-${stepIndex}`}
                  className="w-full"
                  data-testid={`step-mode-select-${stepIndex}`}
                >
                  <SelectValue placeholder="Select a mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interactive">interactive</SelectItem>
                  <SelectItem value="autonomous">autonomous</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {stepErrors?.mode && (
            <p className="text-xs text-destructive">{stepErrors.mode.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-agent-${stepIndex}`}>Agent</Label>
          <Controller
            name={`steps.${stepIndex}.agent`}
            control={control}
            render={({ field }) => (
              <AgentModelPicker
                id={`step-agent-${stepIndex}`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                entries={agentEntries}
                isFetching={catalogFetching}
                isReachable={isReachable}
                data-testid={`step-agent-input-${stepIndex}`}
                placeholder="agent/persona"
              />
            )}
          />
          {stepErrors?.agent && (
            <p className="text-xs text-destructive">{stepErrors.agent.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-model-${stepIndex}`}>Model</Label>
          <Controller
            name={`steps.${stepIndex}.model`}
            control={control}
            render={({ field }) => (
              <AgentModelPicker
                id={`step-model-${stepIndex}`}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                entries={modelEntries}
                isFetching={catalogFetching}
                isReachable={isReachable}
                data-testid={`step-model-input-${stepIndex}`}
                placeholder="model-id"
              />
            )}
          />
          {stepErrors?.model && (
            <p className="text-xs text-destructive">{stepErrors.model.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`step-variant-${stepIndex}`}>Model variant</Label>
          <Input
            id={`step-variant-${stepIndex}`}
            {...register(`steps.${stepIndex}.variant`)}
            placeholder="default"
            data-testid={`step-variant-input-${stepIndex}`}
          />
        </div>

        <div className="flex flex-col gap-1 col-span-2">
          <Label htmlFor={`step-description-${stepIndex}`}>Description</Label>
          <Textarea
            id={`step-description-${stepIndex}`}
            rows={4}
            {...register(`steps.${stepIndex}.description`)}
            placeholder="Step description"
          />
        </div>
      </div>

      <EdgesField stepIndex={stepIndex} control={control} />
    </div>
  )
}
