import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  updateWorkflow,
} from '@/lib/api/client'
import type {
  WorkflowCreateBody,
  WorkflowScope,
  WorkflowUpdateBody,
} from '@/lib/api/types'
import { useCwdStore } from '@/stores/cwd-store'
import { workflowListQueryKey } from './useWorkflowList'

// Per-workflow queries are addressed by (scope, name): a global and a project
// workflow may share a name (ADR-003), so scope must be part of the cache key to
// keep the two entries from colliding. The combined list stays keyed by cwd only
// (useWorkflowList) — it already merges both scopes server-side.
export function workflowQueryKey(
  cwdPath: string | null,
  scope: WorkflowScope,
  name: string | undefined,
) {
  return ['workflow', cwdPath, scope, name] as const
}

export function useWorkflow(name: string | undefined, scope: WorkflowScope = 'project') {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: workflowQueryKey(activeCwd?.path ?? null, scope, name),
    queryFn: () => getWorkflow(activeCwd!.path, scope, name!),
    enabled: activeCwd !== null && name !== undefined,
  })
}

// Mutation hooks own scope forwarding and combined-list invalidation; callers
// (the editor/list components) supply the target scope and handle UI concerns
// (navigation, error messages) via the returned mutation object.
export function useCreateWorkflow() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { scope: WorkflowScope; body: WorkflowCreateBody }) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return createWorkflow(activeCwd.path, vars.scope, vars.body)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workflowListQueryKey(activeCwd?.path ?? null),
      }),
  })
}

export function useUpdateWorkflow() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { scope: WorkflowScope; name: string; body: WorkflowUpdateBody }) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return updateWorkflow(activeCwd.path, vars.scope, vars.name, vars.body)
    },
    onSuccess: (doc, vars) => {
      const cwd = activeCwd?.path ?? null
      // Seed the per-workflow cache with the freshly saved doc so the next mount of
      // the editor reads post-edit content immediately. Plain invalidation is not
      // enough: the stale entry is returned synchronously before the refetch lands
      // and RHF seeds from defaultValues only once, keeping the pre-edit values.
      queryClient.setQueryData(workflowQueryKey(cwd, vars.scope, doc.name), doc)
      // On rename the old name's entry is now obsolete; drop it so it can't be read.
      if (doc.name !== vars.name) {
        queryClient.removeQueries({ queryKey: workflowQueryKey(cwd, vars.scope, vars.name) })
      }
      queryClient.invalidateQueries({ queryKey: workflowListQueryKey(cwd) })
    },
  })
}

export function useDeleteWorkflow() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: { scope: WorkflowScope; name: string }) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return deleteWorkflow(activeCwd.path, vars.scope, vars.name)
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: workflowListQueryKey(activeCwd?.path ?? null),
      }),
  })
}
