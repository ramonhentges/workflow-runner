import { useQuery } from '@tanstack/react-query'
import { getWorkflow } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'

export function workflowQueryKey(cwdPath: string | null, name: string | undefined) {
  return ['workflow', cwdPath, name] as const
}

export function useWorkflow(name: string | undefined) {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: workflowQueryKey(activeCwd?.path ?? null, name),
    queryFn: () => getWorkflow(activeCwd!.path, name!),
    enabled: activeCwd !== null && name !== undefined,
  })
}
