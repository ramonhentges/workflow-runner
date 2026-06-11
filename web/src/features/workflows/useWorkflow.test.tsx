import { describe, test, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import {
  workflowQueryKey,
  useWorkflow,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
} from './useWorkflow'
import { workflowListQueryKey } from './useWorkflowList'

const BASE = 'http://127.0.0.1:4517'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function makeHookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
})

// ── Cache key scoping ─────────────────────────────────────────────────────────

describe('workflowQueryKey', () => {
  test('differs for the same name under global vs project scope', () => {
    const projectKey = workflowQueryKey('/p', 'project', 'shared')
    const globalKey = workflowQueryKey('/p', 'global', 'shared')

    expect(projectKey).not.toEqual(globalKey)
    expect(projectKey).toEqual(['workflow', '/p', 'project', 'shared'])
    expect(globalKey).toEqual(['workflow', '/p', 'global', 'shared'])
  })
})

// ── Detail hook ───────────────────────────────────────────────────────────────

describe('useWorkflow', () => {
  test('forwards scope to getWorkflow as a query param', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          name: 'my-flow',
          path: '/global/workflows/my-flow.json',
          workflow: {},
        })
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(() => useWorkflow('my-flow', 'global'), {
      wrapper: makeHookWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const params = new URL(capturedUrl).searchParams
    expect(params.get('scope')).toBe('global')
    expect(params.get('cwd')).toBe('/p')
  })

  test('defaults to project scope when none is supplied', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedScope: string | null = null

    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({ name: 'my-flow', path: '/p/workflows/my-flow.json', workflow: {} })
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(() => useWorkflow('my-flow'), {
      wrapper: makeHookWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedScope).toBe('project')
  })

  test('uses a scope-specific cache key so same-named scopes do not collide', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/workflows/:name`, ({ request }) => {
        const scope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({
          name: 'shared',
          path: `/${scope}/workflows/shared.json`,
          workflow: { id: scope },
        })
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(
      () => ({
        project: useWorkflow('shared', 'project'),
        global: useWorkflow('shared', 'global'),
      }),
      { wrapper: makeHookWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.project.isSuccess).toBe(true)
      expect(result.current.global.isSuccess).toBe(true)
    })

    // Independent cache entries — each carries its own scope's document.
    expect((result.current.project.data?.workflow as { id: string }).id).toBe('project')
    expect((result.current.global.data?.workflow as { id: string }).id).toBe('global')
  })

  test('does not fetch without an active cwd', async () => {
    let fetched = false
    server.use(
      http.get(`${BASE}/workflows/:name`, () => {
        fetched = true
        return HttpResponse.json({})
      }),
    )

    const queryClient = makeQueryClient()
    const { result } = renderHook(() => useWorkflow('my-flow', 'global'), {
      wrapper: makeHookWrapper(queryClient),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ── Create mutation ───────────────────────────────────────────────────────────

describe('useCreateWorkflow', () => {
  test('sends the supplied scope and invalidates the combined list', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedScope: string | null = null

    server.use(
      http.post(`${BASE}/workflows`, ({ request }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({ name: 'new', path: '/global/workflows/new.json', workflow: {} })
      }),
    )

    const queryClient = makeQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useCreateWorkflow(), {
      wrapper: makeHookWrapper(queryClient),
    })

    result.current.mutate({ scope: 'global', body: { name: 'new', workflow: {} } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedScope).toBe('global')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowListQueryKey('/p'),
    })
  })
})

// ── Update mutation ───────────────────────────────────────────────────────────

describe('useUpdateWorkflow', () => {
  test('sends the supplied scope and invalidates the combined list', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedScope: string | null = null

    server.use(
      http.put(`${BASE}/workflows/:name`, ({ request }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({ name: 'edit', path: '/global/workflows/edit.json', workflow: {} })
      }),
    )

    const queryClient = makeQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: makeHookWrapper(queryClient),
    })

    result.current.mutate({ scope: 'global', name: 'edit', body: { workflow: {} } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedScope).toBe('global')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowListQueryKey('/p'),
    })
  })

  test('seeds the per-workflow cache with the saved doc so re-open shows fresh content', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    const savedDoc = {
      name: 'edit',
      path: '/global/workflows/edit.json',
      scope: 'global' as const,
      workflow: { id: 'edited' },
    }
    server.use(http.put(`${BASE}/workflows/:name`, () => HttpResponse.json(savedDoc)))

    const queryClient = makeQueryClient()
    // Prime the per-workflow cache with the stale pre-edit doc the editor would read.
    queryClient.setQueryData(workflowQueryKey('/p', 'global', 'edit'), {
      name: 'edit',
      path: '/global/workflows/edit.json',
      scope: 'global',
      workflow: { id: 'stale' },
    })

    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: makeHookWrapper(queryClient),
    })

    result.current.mutate({ scope: 'global', name: 'edit', body: { workflow: { id: 'edited' } } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(queryClient.getQueryData(workflowQueryKey('/p', 'global', 'edit'))).toEqual(savedDoc)
  })

  test('drops the old per-workflow cache entry on rename', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    const savedDoc = {
      name: 'renamed',
      path: '/global/workflows/renamed.json',
      scope: 'global' as const,
      workflow: { id: 'edited' },
    }
    server.use(http.put(`${BASE}/workflows/:name`, () => HttpResponse.json(savedDoc)))

    const queryClient = makeQueryClient()
    queryClient.setQueryData(workflowQueryKey('/p', 'global', 'old'), {
      name: 'old',
      path: '/global/workflows/old.json',
      scope: 'global',
      workflow: { id: 'stale' },
    })

    const { result } = renderHook(() => useUpdateWorkflow(), {
      wrapper: makeHookWrapper(queryClient),
    })

    result.current.mutate({
      scope: 'global',
      name: 'old',
      body: { name: 'renamed', workflow: { id: 'edited' } },
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // New name holds the fresh doc; the obsolete old-name entry is gone.
    expect(queryClient.getQueryData(workflowQueryKey('/p', 'global', 'renamed'))).toEqual(savedDoc)
    expect(queryClient.getQueryData(workflowQueryKey('/p', 'global', 'old'))).toBeUndefined()
  })
})

// ── Delete mutation ───────────────────────────────────────────────────────────

describe('useDeleteWorkflow', () => {
  test('forwards scope and invalidates the combined list', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedScope: string | null = null

    server.use(
      http.delete(`${BASE}/workflows/:name`, ({ request }) => {
        capturedScope = new URL(request.url).searchParams.get('scope')
        return HttpResponse.json({ deleted: 'gone' })
      }),
    )

    const queryClient = makeQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useDeleteWorkflow(), {
      wrapper: makeHookWrapper(queryClient),
    })

    result.current.mutate({ scope: 'global', name: 'gone' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedScope).toBe('global')
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowListQueryKey('/p'),
    })
  })
})
