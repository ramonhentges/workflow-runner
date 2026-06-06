import { useQuery } from '@tanstack/react-query'
import { getIdeCatalog } from '@/lib/api/client'
import { useCwdStore } from '@/stores/cwd-store'

export function ideCatalogQueryKey(cwdPath: string | null, ide: string | undefined) {
  return ['ide-catalog', cwdPath, ide] as const
}

export function useIdeCatalog(ide: string | undefined) {
  const activeCwd = useCwdStore(state => state.activeCwd())

  return useQuery({
    queryKey: ideCatalogQueryKey(activeCwd?.path ?? null, ide),
    queryFn: () => getIdeCatalog(activeCwd!.path, ide!),
    enabled: activeCwd !== null && ide !== undefined && ide !== '',
    // Each probe spawns a real IDE subprocess over ACP, so probing must be
    // deliberate (on IDE selection), never incidental.
    staleTime: 5 * 60_000, // probe result stays fresh for the editing session
    refetchOnWindowFocus: false, // never re-spawn a subprocess on tab focus
    retry: false, // failures already return a 200 reachable:false envelope
  })
}
