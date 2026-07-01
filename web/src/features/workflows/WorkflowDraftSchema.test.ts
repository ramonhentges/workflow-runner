import { describe, test, expect } from 'vitest'
import {
  WorkflowDraftSchema,
  blankWorkflow,
  workflowDocToFormData,
  toWorkflowPayload,
} from './WorkflowDraftSchema'

function validDraft() {
  return {
    fileName: 'my-flow',
    workflowId: 'my-flow',
    workflowName: 'My Flow',
    description: '',
    version: '1.0',
    steps: [
      {
        id: 'step-1',
        agent: 'architect-advisor',
        model: 'big-model',
        variant: '',
        ide: 'claude-code',
        mode: 'interactive' as const,
        description: '',
        edges: [],
      },
    ],
  }
}

describe('WorkflowDraftSchema — basic validation', () => {
  test('accepts a valid draft', () => {
    const result = WorkflowDraftSchema.safeParse(validDraft())
    expect(result.success).toBe(true)
  })

  test('requires fileName', () => {
    const result = WorkflowDraftSchema.safeParse({ ...validDraft(), fileName: '' })
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(i => i.path[0] === 'fileName')
    expect(issue).toBeDefined()
  })

  test('rejects fileName with /', () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validDraft(),
      fileName: 'path/to/file',
    })
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(i => i.path[0] === 'fileName')
    expect(issue).toBeDefined()
  })

  test('rejects fileName with \\', () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validDraft(),
      fileName: 'path\\file',
    })
    expect(result.success).toBe(false)
  })

  test('rejects fileName equal to ..', () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validDraft(),
      fileName: '..',
    })
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(i => i.path[0] === 'fileName')
    expect(issue).toBeDefined()
  })

  test('rejects fileName containing ..', () => {
    const result = WorkflowDraftSchema.safeParse({
      ...validDraft(),
      fileName: '..foo',
    })
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(i => i.path[0] === 'fileName')
    expect(issue).toBeDefined()
  })

  test('requires at least one step', () => {
    const result = WorkflowDraftSchema.safeParse({ ...validDraft(), steps: [] })
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(i => i.path[0] === 'steps')
    expect(issue).toBeDefined()
  })

  test('requires step id', () => {
    const draft = validDraft()
    draft.steps[0].id = ''
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
    const issue = result.error!.issues.find(
      i => JSON.stringify(i.path) === JSON.stringify(['steps', 0, 'id']),
    )
    expect(issue).toBeDefined()
  })

  test('requires step agent', () => {
    const draft = validDraft()
    draft.steps[0].agent = ''
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  test('requires step model', () => {
    const draft = validDraft()
    draft.steps[0].model = ''
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })

  test('rejects invalid mode', () => {
    const draft = { ...validDraft(), steps: [{ ...validDraft().steps[0], mode: 'magic' }] }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })
})

describe('WorkflowDraftSchema — duplicate step id', () => {
  test('duplicate step ids produce a field error on the second step id', () => {
    const draft = {
      ...validDraft(),
      steps: [
        { ...validDraft().steps[0], id: 'step-1' },
        {
          id: 'step-1',
          agent: 'other',
          model: 'other-model',
          ide: 'opencode',
          mode: 'autonomous' as const,
          description: '',
          edges: [],
        },
      ],
    }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
    const dupIssue = result.error!.issues.find(
      i => JSON.stringify(i.path) === JSON.stringify(['steps', 1, 'id']),
    )
    expect(dupIssue).toBeDefined()
    expect(dupIssue?.message).toMatch(/duplicate/i)
  })

  test('unique step ids pass', () => {
    const draft = {
      ...validDraft(),
      steps: [
        { ...validDraft().steps[0], id: 'step-1' },
        {
          id: 'step-2',
          agent: 'other',
          model: 'other-model',
          ide: 'opencode',
          mode: 'autonomous' as const,
          description: '',
          edges: [],
        },
      ],
    }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(true)
  })
})

describe('WorkflowDraftSchema — edge next_step references', () => {
  test('edge with next_step that does not match any step id produces a field error', () => {
    const draft = {
      ...validDraft(),
      steps: [
        {
          ...validDraft().steps[0],
          edges: [{ next_step: 'nonexistent', intent: '' }],
        },
      ],
    }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
    const edgeIssue = result.error!.issues.find(
      i => JSON.stringify(i.path) === JSON.stringify(['steps', 0, 'edges', 0, 'next_step']),
    )
    expect(edgeIssue).toBeDefined()
    expect(edgeIssue?.message).toMatch(/nonexistent/)
  })

  test('edge with valid next_step reference passes', () => {
    const draft = {
      ...validDraft(),
      steps: [
        {
          ...validDraft().steps[0],
          id: 'step-1',
          edges: [{ next_step: 'step-2', intent: 'go next' }],
        },
        {
          id: 'step-2',
          agent: 'agent',
          model: 'model',
          ide: 'opencode',
          mode: 'autonomous' as const,
          description: '',
          edges: [],
        },
      ],
    }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(true)
  })

  test('edge with empty next_step requires it to be non-empty', () => {
    const draft = {
      ...validDraft(),
      steps: [
        {
          ...validDraft().steps[0],
          edges: [{ next_step: '', intent: '' }],
        },
      ],
    }
    const result = WorkflowDraftSchema.safeParse(draft)
    expect(result.success).toBe(false)
  })
})

describe('blankWorkflow', () => {
  test('returns a draft with empty steps array', () => {
    const blank = blankWorkflow()
    expect(blank.steps).toHaveLength(0)
    expect(blank.fileName).toBe('')
  })
})

describe('workflowDocToFormData', () => {
  const sampleDoc = {
    name: 'who-is',
    path: '/p/workflows/who-is.json',
    scope: 'project' as const,
    workflow: {
      id: 'who-is-id',
      name: 'Who Is',
      description: 'Sample workflow',
      version: '1.0',
      steps: [
        {
          id: 'step-1',
          agent: 'architect',
          model: 'big-model',
          variant: 'high',
          ide: 'claude-code',
          mode: 'interactive',
          description: 'First step',
          edges: [{ next_step: 'step-2', intent: 'handoff' }],
        },
        {
          id: 'step-2',
          agent: 'coder',
          model: 'fast-model',
          ide: 'opencode',
          mode: 'autonomous',
          description: 'Second step',
          edges: [],
        },
      ],
    },
  }

  test('maps WorkflowDoc to form data preserving all fields', () => {
    const form = workflowDocToFormData(sampleDoc)
    expect(form.fileName).toBe('who-is')
    expect(form.workflowId).toBe('who-is-id')
    expect(form.workflowName).toBe('Who Is')
    expect(form.description).toBe('Sample workflow')
    expect(form.version).toBe('1.0')
    expect(form.steps).toHaveLength(2)
    expect(form.steps[0].id).toBe('step-1')
    expect(form.steps[0].agent).toBe('architect')
    expect(form.steps[0].variant).toBe('high')
    expect(form.steps[0].edges).toHaveLength(1)
    expect(form.steps[0].edges[0].next_step).toBe('step-2')
    expect(form.steps[1].mode).toBe('autonomous')
    expect(form.steps[1].variant).toBe('')
  })

  test('override fileName replaces the doc name', () => {
    const form = workflowDocToFormData(sampleDoc, 'copy-of-who-is')
    expect(form.fileName).toBe('copy-of-who-is')
    expect(form.workflowId).toBe('who-is-id')
  })

  test('handles missing or malformed workflow fields gracefully', () => {
    const doc = { name: 'empty', path: '/p/empty.json', scope: 'project' as const, workflow: {} }
    const form = workflowDocToFormData(doc)
    expect(form.fileName).toBe('empty')
    expect(form.workflowId).toBe('')
    expect(form.steps).toHaveLength(0)
  })

  test('duplicate mode (empty override) does not copy id/name verbatim', () => {
    const form = workflowDocToFormData(sampleDoc, '')
    expect(form.fileName).toBe('')
    expect(form.workflowId).not.toBe('who-is-id')
    expect(form.workflowId).toBe('who-is-id copy')
    expect(form.workflowName).toBe('Who Is copy')
    // steps are still carried over so the copy is a real baseline to edit from
    expect(form.steps).toHaveLength(2)
    expect(form.steps[0].id).toBe('step-1')
  })

  test('duplicate mode leaves an empty source id/name empty', () => {
    const doc = { name: 'empty', path: '/p/empty.json', scope: 'project' as const, workflow: {} }
    const form = workflowDocToFormData(doc, '')
    expect(form.workflowId).toBe('')
    expect(form.workflowName).toBe('')
  })

  test('edit mode (no override) round-trips id/name unchanged', () => {
    const form = workflowDocToFormData(sampleDoc)
    expect(form.workflowId).toBe('who-is-id')
    expect(form.workflowName).toBe('Who Is')
  })
})

describe('toWorkflowPayload', () => {
  test('converts form data to the workflow JSON payload', () => {
    const draft = validDraft()
    draft.steps[0].variant = 'high'
    const payload = toWorkflowPayload(draft) as Record<string, unknown>
    expect(payload.id).toBe('my-flow')
    expect(payload.name).toBe('My Flow')
    expect(payload.description).toBe('')
    expect(payload.version).toBe('1.0')
    const steps = payload.steps as Array<Record<string, unknown>>
    expect(steps).toHaveLength(1)
    expect(steps[0].id).toBe('step-1')
    expect(steps[0].mode).toBe('interactive')
    expect(steps[0].variant).toBe('high')
  })

  test('omits variant from the workflow JSON payload when it is blank', () => {
    const payload = toWorkflowPayload(validDraft()) as Record<string, unknown>
    const steps = payload.steps as Array<Record<string, unknown>>

    expect(steps[0]).not.toHaveProperty('variant')
  })
})
