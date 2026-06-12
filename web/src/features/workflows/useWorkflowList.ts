import { useQuery } from '@tanstack/react-query'
import { listWorkflows } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'
import { compareWorkflowsByName } from './workflowNames'

export function workflowListQueryKey(cwdPath: string | null) {
  return ['workflows', cwdPath] as const
}

export function useWorkflowList() {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: workflowListQueryKey(activeCwd?.path ?? null),
    queryFn: () => listWorkflows(activeCwd!.path),
    enabled: activeCwd !== null,
    // Present workflows alphabetically in both the table and the start-run
    // picker. Spread before sort: Array.sort mutates and the query cache array
    // is shared.
    select: data => ({
      ...data,
      workflows: [...data.workflows].sort(compareWorkflowsByName),
    }),
  })
}
