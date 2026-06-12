import { describe, test, expect } from 'vitest'
import { compareWorkflowsByName } from './workflowNames'
import type { WorkflowItem } from '@/lib/api/types'

function item(name: string, scope: WorkflowItem['scope'] = 'project'): WorkflowItem {
  return { name, path: `/cwd/workflows/${name}`, scope }
}

describe('compareWorkflowsByName', () => {
  test('orders by display name (.json stripped), case-insensitively', () => {
    const sorted = [item('zeta.json'), item('Alpha.json'), item('beta.json')]
      .sort(compareWorkflowsByName)
      .map(w => w.name)
    expect(sorted).toEqual(['Alpha.json', 'beta.json', 'zeta.json'])
  })

  test('uses scope as a stable tiebreaker when names match', () => {
    const sorted = [item('who-is.json', 'project'), item('who-is.json', 'global')]
      .sort(compareWorkflowsByName)
      .map(w => w.scope)
    expect(sorted).toEqual(['global', 'project'])
  })
})
