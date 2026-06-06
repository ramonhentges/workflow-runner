import { z } from 'zod'
import type { WorkflowDoc } from '@/lib/api/types'

export const EdgeDraftSchema = z.object({
  next_step: z.string().min(1, 'Target step ID is required'),
  intent: z.string(),
})

export const StepDraftSchema = z.object({
  id: z.string().min(1, 'Step ID is required'),
  agent: z.string().min(1, 'Agent is required'),
  model: z.string().min(1, 'Model is required'),
  ide: z.string().min(1, 'IDE is required'),
  mode: z.enum(['interactive', 'autonomous']),
  description: z.string(),
  edges: z.array(EdgeDraftSchema),
})

export const WorkflowDraftSchema = z
  .object({
    fileName: z
      .string()
      .min(1, 'File name is required')
      .regex(/^[^/\\]+$/, 'File name cannot contain / or \\')
      .refine(v => !v.includes('..'), 'File name cannot contain ".."'),
    workflowId: z.string(),
    workflowName: z.string(),
    description: z.string(),
    version: z.string(),
    steps: z.array(StepDraftSchema).min(1, 'At least one step is required'),
  })
  .superRefine((val, ctx) => {
    const seenIds = new Map<string, number>()
    val.steps.forEach((step, i) => {
      if (seenIds.has(step.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate step id: "${step.id}"`,
          path: ['steps', i, 'id'],
          input: step.id,
        })
      } else {
        seenIds.set(step.id, i)
      }
    })

    const allIds = new Set(val.steps.map(s => s.id))
    val.steps.forEach((step, si) => {
      step.edges.forEach((edge, ei) => {
        if (edge.next_step && !allIds.has(edge.next_step)) {
          ctx.addIssue({
            code: 'custom',
            message: `No step with id "${edge.next_step}"`,
            path: ['steps', si, 'edges', ei, 'next_step'],
            input: edge.next_step,
          })
        }
      })
    })
  })

export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>
export type StepDraft = z.infer<typeof StepDraftSchema>
export type EdgeDraft = z.infer<typeof EdgeDraftSchema>

export function blankWorkflow(): WorkflowDraft {
  return {
    fileName: '',
    workflowId: '',
    workflowName: '',
    description: '',
    version: '1.0',
    steps: [],
  }
}

export function workflowDocToFormData(
  doc: WorkflowDoc,
  overrideFileName?: string,
): WorkflowDraft {
  const wf = doc.workflow as Record<string, unknown>
  const steps = Array.isArray(wf.steps) ? wf.steps : []

  // The duplicate flow signals "this is a fresh copy" by passing an empty
  // overrideFileName (blanking the file name so the author must choose a new
  // one). In that mode, suffix the internal identity so the copy doesn't share
  // the source's id/name verbatim — otherwise an unedited duplicate would
  // silently produce two files with one workflow identity. Plain edit
  // (undefined) and explicit rename (non-empty) round-trip identity unchanged.
  const isDuplicate = overrideFileName === ''
  const sourceId = typeof wf.id === 'string' ? wf.id : ''
  const sourceName = typeof wf.name === 'string' ? wf.name : ''
  const suffixCopy = (v: string) => (v ? `${v} copy` : '')

  return {
    fileName: overrideFileName ?? doc.name,
    workflowId: isDuplicate ? suffixCopy(sourceId) : sourceId,
    workflowName: isDuplicate ? suffixCopy(sourceName) : sourceName,
    description: typeof wf.description === 'string' ? wf.description : '',
    version: typeof wf.version === 'string' ? wf.version : '',
    steps: steps.map((rawStep: unknown) => {
      const s = rawStep as Record<string, unknown>
      return {
        id: typeof s.id === 'string' ? s.id : '',
        agent: typeof s.agent === 'string' ? s.agent : '',
        model: typeof s.model === 'string' ? s.model : '',
        ide: typeof s.ide === 'string' ? s.ide : '',
        mode:
          s.mode === 'interactive' || s.mode === 'autonomous'
            ? s.mode
            : 'interactive',
        description: typeof s.description === 'string' ? s.description : '',
        edges: Array.isArray(s.edges)
          ? s.edges.map((e: unknown) => {
              const edge = e as Record<string, unknown>
              return {
                next_step: typeof edge.next_step === 'string' ? edge.next_step : '',
                intent: typeof edge.intent === 'string' ? edge.intent : '',
              }
            })
          : [],
      }
    }),
  }
}

export function toWorkflowPayload(data: WorkflowDraft): unknown {
  return {
    id: data.workflowId,
    name: data.workflowName,
    description: data.description,
    version: data.version,
    steps: data.steps.map(step => ({
      id: step.id,
      agent: step.agent,
      model: step.model,
      ide: step.ide,
      mode: step.mode,
      description: step.description,
      edges: step.edges,
    })),
  }
}
