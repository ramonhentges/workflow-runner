import { useQuery } from '@tanstack/react-query'
import { listWorkflows } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'

export function useWorkflows() {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: ['workflows', activeCwd?.path ?? null],
    queryFn: () => listWorkflows(activeCwd!.path),
    enabled: activeCwd !== null,
  })
}
