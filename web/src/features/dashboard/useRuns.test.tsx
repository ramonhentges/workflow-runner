import { describe, test, expect, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { useRuns } from './useRuns'
import type { RunSummary } from '@/lib/api/types'

const BASE = 'http://127.0.0.1:4517'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { wrapper, queryClient }
}

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    slug: 'abc-def',
    workflowPath: '/tmp/workflows/wf.json',
    currentStepId: null,
    status: 'running',
    startedAt: 1000,
    endedAt: null,
    attachedCount: 0,
    ...overrides,
  }
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
})

describe('useRuns', () => {
  test('issues GET /runs filtered by the active cwd path', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedUrl = ''
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ runs: [] })
      }),
    )

    const { wrapper } = makeWrapper()
    renderHook(() => useRuns(), { wrapper })

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy()
    })

    const url = new URL(capturedUrl)
    expect(url.searchParams.get('cwd')).toBe('/projects/myapp')
    expect(url.searchParams.get('all')).toBeNull()
  })

  test('appends all=true to the request URL when all option is true', async () => {
    useCwdStore.getState().addCwd('proj', '/projects/myapp')

    let capturedUrl = ''
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({ runs: [] })
      }),
    )

    const { wrapper } = makeWrapper()
    renderHook(() => useRuns({ all: true }), { wrapper })

    await waitFor(() => {
      expect(capturedUrl).toBeTruthy()
    })

    const url = new URL(capturedUrl)
    expect(url.searchParams.get('all')).toBe('true')
  })

  test('does not fetch when no active cwd is set', async () => {
    let requestFired = false
    server.use(
      http.get(`${BASE}/runs`, () => {
        requestFired = true
        return HttpResponse.json({ runs: [] })
      }),
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRuns(), { wrapper })

    // Give the query time to fire if it were going to
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(requestFired).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('returns the runs array on successful response', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const mockRuns = [makeRunSummary({ id: 'run-1', status: 'running' })]

    server.use(
      http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: mockRuns })),
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRuns(), { wrapper })

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true)
    })

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data![0].id).toBe('run-1')
  })

  test('reflects error state when the request fails', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/runs`, () => HttpResponse.json({ code: 'ERR' }, { status: 500 })),
    )

    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useRuns(), { wrapper })

    await waitFor(() => {
      expect(result.current.isError).toBe(true)
    })
  })

  test('re-issues the query with a different key when all toggles to true', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    const capturedUrls: string[] = []
    server.use(
      http.get(`${BASE}/runs`, ({ request }) => {
        capturedUrls.push(request.url)
        return HttpResponse.json({ runs: [] })
      }),
    )

    const { wrapper } = makeWrapper()
    const { rerender } = renderHook(({ all }) => useRuns({ all }), {
      wrapper,
      initialProps: { all: false },
    })

    await waitFor(() => {
      expect(capturedUrls.length).toBeGreaterThanOrEqual(1)
    })

    rerender({ all: true })

    await waitFor(() => {
      expect(capturedUrls.some(url => new URL(url).searchParams.get('all') === 'true')).toBe(true)
    })
  })
})
