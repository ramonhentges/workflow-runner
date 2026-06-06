import { useState } from 'react'
import { useForm, useFieldArray, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCwdStore } from '@/stores/cwd-store'
import { ApiError, createWorkflow, updateWorkflow } from '@/lib/api/client'
import type { WorkflowUpdateBody } from '@/lib/api/types'
import { workflowListQueryKey } from './useWorkflowList'
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
}

export function WorkflowEditor({ mode, existingName, initialValues }: WorkflowEditorProps) {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState('')

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

  const mutation = useMutation({
    mutationFn: async (data: WorkflowDraft) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      const workflow = toWorkflowPayload(data)

      if (mode === 'create') {
        return createWorkflow(activeCwd.path, { name: data.fileName, workflow })
      } else {
        const body: WorkflowUpdateBody = { workflow }
        if (data.fileName !== existingName) {
          body.name = data.fileName
        }
        return updateWorkflow(activeCwd.path, existingName!, body)
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: workflowListQueryKey(activeCwd?.path ?? null),
      })
      await navigate({ to: '/workflows' })
    },
    onError: error => {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        error.code === 'WORKFLOW_INVALID'
      ) {
        setServerError(error.message)
      } else {
        setServerError(error instanceof Error ? error.message : 'Save failed.')
      }
    },
  })

  function handleSubmit(data: WorkflowDraft) {
    setServerError('')
    mutation.mutate(data)
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

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Workflow</h3>

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
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">Steps</h3>
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
          </div>

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
        </div>

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
          <Button type="submit" disabled={mutation.isPending} data-testid="save-button">
            {mutation.isPending ? 'Saving…' : 'Save workflow'}
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
