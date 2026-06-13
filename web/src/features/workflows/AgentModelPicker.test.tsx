import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { server } from '../../../test/setup'
import { useCwdStore } from '@/stores/cwd-store'
import { AgentModelPicker } from './AgentModelPicker'
import { useIdeCatalog } from './useIdeCatalog'

const BASE = 'http://127.0.0.1:4517/api'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// ── AgentModelPicker unit tests ───────────────────────────────────────────────

describe('AgentModelPicker', () => {
  test('renders entries as datalist options when reachable', () => {
    const entries = [
      { id: 'agent-1', name: 'Agent One' },
      { id: 'agent-2', name: 'Agent Two' },
    ]
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={entries}
        isFetching={false}
        isReachable={true}
        data-testid="agent-picker"
      />,
    )
    const options = document.querySelectorAll('datalist option')
    const values = Array.from(options).map(o => o.getAttribute('value'))
    expect(values).toContain('agent-1')
    expect(values).toContain('agent-2')
  })

  test('shows "Suggestions from IDE" status when reachable and has entries', () => {
    const entries = [{ id: 'agent-1', name: 'Agent One' }]
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={entries}
        isFetching={false}
        isReachable={true}
        data-testid="agent-picker"
      />,
    )
    expect(screen.getByTestId('agent-picker-status')).toHaveTextContent(/suggestions from ide/i)
  })

  test('accepts a typed value not in the suggestions list', async () => {
    const user = userEvent.setup()

    function TestWrapper() {
      const [val, setVal] = useState('')
      return (
        <AgentModelPicker
          value={val}
          onChange={setVal}
          entries={[{ id: 'agent-1', name: 'Agent One' }]}
          isFetching={false}
          isReachable={true}
          data-testid="agent-picker"
        />
      )
    }

    render(<TestWrapper />)
    await user.type(screen.getByTestId('agent-picker'), 'custom-agent')
    expect(screen.getByTestId('agent-picker')).toHaveValue('custom-agent')
  })

  test('shows "IDE unreachable — enter manually" when reachable is false', () => {
    render(
      <AgentModelPicker
        value="my-typed-value"
        onChange={() => {}}
        entries={[]}
        isFetching={false}
        isReachable={false}
        data-testid="agent-picker"
      />,
    )
    expect(screen.getByTestId('agent-picker-status')).toHaveTextContent(/ide unreachable/i)
    expect(screen.getByTestId('agent-picker')).toHaveValue('my-typed-value')
  })

  test('preserves the typed value when catalog is unreachable', () => {
    const { rerender } = render(
      <AgentModelPicker
        value="preserved-value"
        onChange={() => {}}
        entries={[]}
        isFetching={false}
        isReachable={undefined}
        data-testid="agent-picker"
      />,
    )

    rerender(
      <AgentModelPicker
        value="preserved-value"
        onChange={() => {}}
        entries={[]}
        isFetching={false}
        isReachable={false}
        data-testid="agent-picker"
      />,
    )

    expect(screen.getByTestId('agent-picker')).toHaveValue('preserved-value')
    expect(screen.getByTestId('agent-picker-status')).toHaveTextContent(/ide unreachable/i)
  })

  test('shows loading state while fetching', () => {
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={[]}
        isFetching={true}
        isReachable={undefined}
        data-testid="agent-picker"
      />,
    )
    expect(screen.getByTestId('agent-picker-status')).toHaveTextContent(/loading suggestions/i)
  })

  test('shows no status indicator when not fetching and catalog is not yet available', () => {
    render(
      <AgentModelPicker
        value="manual-value"
        onChange={() => {}}
        entries={[]}
        isFetching={false}
        isReachable={undefined}
        data-testid="agent-picker"
      />,
    )
    expect(screen.queryByTestId('agent-picker-status')).not.toBeInTheDocument()
    expect(screen.getByTestId('agent-picker')).toHaveValue('manual-value')
  })

  test('does not show suggestions-from-ide status when entries are empty (reachable but empty)', () => {
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={[]}
        isFetching={false}
        isReachable={true}
        data-testid="agent-picker"
      />,
    )
    expect(screen.queryByTestId('agent-picker-status')).not.toBeInTheDocument()
  })

  test('renders option without label when entry name matches id', () => {
    const entries = [{ id: 'agent-1', name: 'agent-1' }]
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={entries}
        isFetching={false}
        isReachable={true}
        data-testid="agent-picker"
      />,
    )
    const option = document.querySelector('datalist option')
    expect(option?.getAttribute('value')).toBe('agent-1')
    expect(option?.getAttribute('label')).toBeNull()
  })

  test('renders status elements without data-testid when no testid prop is given', () => {
    render(
      <AgentModelPicker
        value=""
        onChange={() => {}}
        entries={[{ id: 'a', name: 'A' }]}
        isFetching={true}
        isReachable={undefined}
      />,
    )
    const statusEl = document.querySelector('p.text-xs')
    expect(statusEl).toBeInTheDocument()
    expect(statusEl?.getAttribute('data-testid')).toBeNull()
  })
})

// ── useIdeCatalog unit tests ──────────────────────────────────────────────────

describe('useIdeCatalog', () => {
  beforeEach(() => {
    useCwdStore.setState({ cwds: [], activeCwdId: null })
  })

  test('fetches catalog for the selected IDE with active cwd, query key includes ide and cwd', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let capturedUrl = ''

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json({
          reachable: true,
          agents: [{ id: 'agent-1', name: 'Agent One' }],
          models: [{ id: 'model-1', name: 'Model One' }],
        })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useIdeCatalog('opencode'), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const url = new URL(capturedUrl)
    expect(url.pathname).toContain('opencode')
    expect(url.searchParams.get('cwd')).toBe('/p')
    expect(result.current.data?.reachable).toBe(true)
    expect(result.current.data?.agents).toHaveLength(1)
    expect(result.current.data?.models).toHaveLength(1)
  })

  test('does not fetch when no active cwd', async () => {
    let fetched = false
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetched = true
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useIdeCatalog('opencode'), {
      wrapper: makeWrapper(qc),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('does not fetch when ide is undefined', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let fetched = false
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetched = true
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useIdeCatalog(undefined), {
      wrapper: makeWrapper(qc),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('does not fetch when ide is empty string', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let fetched = false
    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetched = true
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useIdeCatalog(''), {
      wrapper: makeWrapper(qc),
    })

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetched).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })

  test('changing the IDE triggers a new fetch with the updated ide in the URL', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const capturedIdes: string[] = []

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, ({ params }) => {
        capturedIdes.push(String(params.ide))
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = makeQueryClient()
    let currentIde = 'opencode'
    const { result, rerender } = renderHook(() => useIdeCatalog(currentIde), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedIdes).toContain('opencode')

    currentIde = 'claude-code'
    rerender()

    await waitFor(() => expect(capturedIdes).toContain('claude-code'))
    expect(capturedIdes).toContain('opencode')
    expect(capturedIdes).toContain('claude-code')
  })

  test('typing agent/model text (unrelated to ide) does not trigger a new catalog fetch', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetchCount++
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = makeQueryClient()
    // Simulate: ide stays 'opencode', agent/model text changes don't affect the query key
    const { result, rerender } = renderHook(
      ({ ide }: { ide: string }) => useIdeCatalog(ide),
      {
        initialProps: { ide: 'opencode' },
        wrapper: makeWrapper(qc),
      },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const countAfterFirstFetch = fetchCount

    // Simulate user typing agent/model - ide doesn't change, so hook is called with same ide
    rerender({ ide: 'opencode' })
    rerender({ ide: 'opencode' })
    rerender({ ide: 'opencode' })

    await new Promise(resolve => setTimeout(resolve, 50))
    // TanStack Query caches the result — no additional fetches for the same key
    expect(fetchCount).toBe(countAfterFirstFetch)
  })

  test('returns reachable:false catalog when IDE probe is unreachable', async () => {
    useCwdStore.getState().addCwd('proj', '/p')

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () =>
        HttpResponse.json({
          reachable: false,
          agents: [],
          models: [],
          reason: 'IDE not found',
        }),
      ),
    )

    const qc = makeQueryClient()
    const { result } = renderHook(() => useIdeCatalog('codex'), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.reachable).toBe(false)
    expect(result.current.data?.reason).toBe('IDE not found')
  })

  test('does not re-spawn a subprocess on window refocus (refetchOnWindowFocus disabled)', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetchCount++
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    // A defaults-free client so the hook's own options govern behavior — this
    // mirrors `new QueryClient()` in production (staleTime: 0, refetch on focus).
    const qc = new QueryClient()
    const { result } = renderHook(() => useIdeCatalog('opencode'), {
      wrapper: makeWrapper(qc),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(fetchCount).toBe(1)

    // Simulate alt-tabbing away and back to the window.
    focusManager.setFocused(false)
    focusManager.setFocused(true)

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)

    focusManager.setFocused(undefined)
  })

  test('reuses the cached probe on remount within the stale window (staleTime set)', async () => {
    useCwdStore.getState().addCwd('proj', '/p')
    let fetchCount = 0

    server.use(
      http.get(`${BASE}/ide/:ide/catalog`, () => {
        fetchCount++
        return HttpResponse.json({ reachable: true, agents: [], models: [] })
      }),
    )

    const qc = new QueryClient()
    const first = renderHook(() => useIdeCatalog('opencode'), {
      wrapper: makeWrapper(qc),
    })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(fetchCount).toBe(1)
    first.unmount()

    // Remounting (e.g. StepFields re-rendered) must not re-probe while fresh.
    const second = renderHook(() => useIdeCatalog('opencode'), {
      wrapper: makeWrapper(qc),
    })
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(fetchCount).toBe(1)
  })
})
