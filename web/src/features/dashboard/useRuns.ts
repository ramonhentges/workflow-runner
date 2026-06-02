import { useQuery } from '@tanstack/react-query'
import { listRuns } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'

export function useRuns(opts: { all?: boolean } = {}) {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: ['runs', { cwd: activeCwd?.path ?? null, all: opts.all ?? false }],
    queryFn: () => listRuns({ cwd: activeCwd!.path, all: opts.all }),
    enabled: activeCwd !== null,
    refetchInterval: 2000,
  })
}
