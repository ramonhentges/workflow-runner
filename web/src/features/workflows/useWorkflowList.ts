import { useQuery } from '@tanstack/react-query'
import { listWorkflows } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'

export function workflowListQueryKey(cwdPath: string | null) {
  return ['workflows', cwdPath] as const
}

export function useWorkflowList() {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: workflowListQueryKey(activeCwd?.path ?? null),
    queryFn: () => listWorkflows(activeCwd!.path),
    enabled: activeCwd !== null,
  })
}
