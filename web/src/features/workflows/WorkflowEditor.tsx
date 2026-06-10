import { useState } from 'react'
import { useForm, useFieldArray, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useCwdStore } from '@/stores/cwd-store'
import { ApiError } from '@/lib/api/client'
import type { WorkflowScope, WorkflowUpdateBody } from '@/lib/api/types'
import { useCreateWorkflow, useUpdateWorkflow } from './useWorkflow'
import { StepFields } from './StepFields'
import {
  WorkflowDraftSchema,
  blankWorkflow,
  toWorkflowPayload,
  type WorkflowDraft,
} from './WorkflowDraftSchema'

interface WorkflowEditorProps {
  mode: 'create' | 'edit'
  existingName?: string
  initialValues?: WorkflowDraft
  // Edit mode: the existing workflow's scope, derived from its file location and
  // shown read-only — edits preserve scope (ADR-003). Ignored in create mode,
  // where the toggle owns the chosen scope (default Project).
  scope?: WorkflowScope
}

function scopeLabel(scope: WorkflowScope): string {
  return scope === 'global' ? 'Global' : 'Project'
}

export function WorkflowEditor({
  mode,
  existingName,
  initialValues,
  scope: existingScope,
}: WorkflowEditorProps) {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')

  // Create chooses scope via the toggle (default Project); edit reuses the
  // existing scope unchanged. `effectiveScope` is what the mutation targets.
  const [createScope, setCreateScope] = useState<WorkflowScope>('project')
  const effectiveScope: WorkflowScope =
    mode === 'edit' ? existingScope ?? 'project' : createScope

  const form = useForm<WorkflowDraft>({
    resolver: zodResolver(WorkflowDraftSchema),
    defaultValues: initialValues ?? blankWorkflow(),
  })

  const {
    fields: stepFields,
    append,
    remove,
    move,
  } = useFieldArray({
    control: form.control,
    name: 'steps',
  })

  // Scope-aware mutations from task_05 own combined-list invalidation; the editor
  // supplies the target scope and handles navigation/error via per-call callbacks.
  const createMutation = useCreateWorkflow()
  const updateMutation = useUpdateWorkflow()
  const isPending = createMutation.isPending || updateMutation.isPending

  function reportError(error: unknown) {
    if (
      error instanceof ApiError &&
      error.status === 400 &&
      error.code === 'WORKFLOW_INVALID'
    ) {
      setServerError(error.message)
    } else {
      setServerError(error instanceof Error ? error.message : 'Save failed.')
    }
  }

  function handleSubmit(data: WorkflowDraft) {
    setServerError('')
    const workflow = toWorkflowPayload(data)
    const callbacks = {
      onSuccess: () => {
        void navigate({ to: '/workflows' })
      },
      onError: reportError,
    }

    if (mode === 'create') {
      createMutation.mutate(
        { scope: effectiveScope, body: { name: data.fileName, workflow } },
        callbacks,
      )
    } else {
      const body: WorkflowUpdateBody = { workflow }
      if (data.fileName !== existingName) {
        body.name = data.fileName
      }
      updateMutation.mutate(
        { scope: effectiveScope, name: existingName!, body },
        callbacks,
      )
    }
  }

  if (!activeCwd) {
    return (
      <div data-testid="no-cwd-prompt" className="text-center py-12 text-muted-foreground">
        <p className="font-medium">No active working directory selected.</p>
        <p className="text-sm mt-1">
          Select or add a working directory using the cwd switcher before managing workflows.
        </p>
      </div>
    )
  }

  const { errors } = form.formState

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex flex-col gap-6 max-w-2xl"
        data-testid="workflow-editor-form"
      >
        <h2 className="text-lg font-semibold">
          {mode === 'create' ? 'New Workflow' : `Edit: ${existingName}`}
        </h2>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Workflow</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <Label>Scope</Label>
              {mode === 'create' ? (
                <div
                  className="flex gap-2"
                  role="group"
                  aria-label="Workflow scope"
                  data-testid="scope-toggle"
                >
                  {(['project', 'global'] as const).map(option => (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={createScope === option ? 'default' : 'outline'}
                      aria-pressed={createScope === option}
                      onClick={() => setCreateScope(option)}
                      data-testid={`scope-toggle-${option}`}
                    >
                      {scopeLabel(option)}
                    </Button>
                  ))}
                </div>
              ) : (
                <Badge
                  variant={effectiveScope === 'global' ? 'secondary' : 'outline'}
                  className="w-fit"
                  data-testid="scope-badge"
                  data-scope={effectiveScope}
                >
                  {scopeLabel(effectiveScope)}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="workflow-filename">File name</Label>
                <Input
                  id="workflow-filename"
                  {...form.register('fileName')}
                  placeholder="my-workflow"
                  data-testid="workflow-filename-input"
                />
                {errors.fileName && (
                  <p className="text-xs text-destructive" data-testid="filename-error">
                    {errors.fileName.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="workflow-name">Display name</Label>
                <Input
                  id="workflow-name"
                  {...form.register('workflowName')}
                  placeholder="My Workflow"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="workflow-id">ID</Label>
                <Input
                  id="workflow-id"
                  {...form.register('workflowId')}
                  placeholder="my-workflow-id"
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="workflow-version">Version</Label>
                <Input
                  id="workflow-version"
                  {...form.register('version')}
                  placeholder="1.0"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="workflow-description">Description</Label>
              <Input
                id="workflow-description"
                {...form.register('description')}
                placeholder="Workflow description"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Steps</CardTitle>
            <CardAction>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    id: '',
                    agent: '',
                    model: '',
                    ide: 'claude-code',
                    mode: 'interactive',
                    description: '',
                    edges: [],
                  })
                }
                data-testid="add-step-button"
              >
                Add step
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {errors.steps && !Array.isArray(errors.steps) && (
              <p className="text-xs text-destructive" data-testid="steps-array-error">
                {(errors.steps as { message?: string }).message}
              </p>
            )}

            {stepFields.map((field, index) => (
              <StepFields
                key={field.id}
                stepIndex={index}
                totalSteps={stepFields.length}
                control={form.control}
                onRemove={() => remove(index)}
                onMoveUp={() => move(index, index - 1)}
                onMoveDown={() => move(index, index + 1)}
              />
            ))}
          </CardContent>
        </Card>

        {serverError && (
          <p
            className="text-sm text-destructive rounded border border-destructive/40 bg-destructive/10 px-3 py-2"
            data-testid="server-error"
            role="alert"
          >
            {serverError}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={isPending} data-testid="save-button">
            {isPending ? 'Saving…' : 'Save workflow'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/workflows' })}
            data-testid="cancel-button"
          >
            Cancel
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}
