import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiBaseUrl } from '../config'
import { openAttach } from './attach-client'
import { initialViewModel } from './reducer'
import type { RunViewModel } from './reducer'
import type { AttachClient } from './attach-client'

export type { RunViewModel }

export function useAttach(runId: string): {
  vm: RunViewModel
  sendInput: (message: string) => void
} {
  const [vm, setVm] = useState<RunViewModel>(initialViewModel)
  const clientRef = useRef<AttachClient | null>(null)

  useEffect(() => {
    const baseUrl = getApiBaseUrl()
    const wsUrl = baseUrl.replace(/^https?/, (m) => (m === 'https' ? 'wss' : 'ws'))
    const client = openAttach(runId, wsUrl)
    clientRef.current = client
    const unsubscribe = client.subscribe(setVm)

    return () => {
      unsubscribe()
      client.close()
      clientRef.current = null
    }
  }, [runId])

  const sendInput = useCallback((message: string) => {
    clientRef.current?.sendInput(message)
  }, [])

  return { vm, sendInput }
}
