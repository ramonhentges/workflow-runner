import { describe, test, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useHealth } from './useHealth'
import type { HealthReport } from '@/lib/api/types'

const BASE = 'http://127.0.0.1:4517/api'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, queryClient }
}

const mockReport: HealthReport = {
  status: 'ok',
  pid: 1234,
  uptimeMs: 5000,
  activeRuns: 2,
  version: '0.1.0',
}

describe('useHealth', () => {
  test('fetches GET /health and returns the report on success', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.json(mockReport)))

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useHealth(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toEqual(mockReport)
  })

  test('reports error state when the daemon is unreachable', async () => {
    server.use(
      http.get(`${BASE}/health`, () => HttpResponse.json({ code: 'DAEMON_DOWN' }, { status: 503 })),
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useHealth(), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })

  test('fires the request immediately without preconditions', async () => {
    let requestFired = false
    server.use(
      http.get(`${BASE}/health`, () => {
        requestFired = true
        return HttpResponse.json(mockReport)
      }),
    )

    const { wrapper } = makeWrapper()
    renderHook(() => useHealth(), { wrapper })

    await waitFor(() => {
      expect(requestFired).toBe(true)
    })
  })
})
