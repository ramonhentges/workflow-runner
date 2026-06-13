import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup'
import { routeTree } from '../router'
import { useCwdStore } from '@/stores/cwd-store'
import { ThemeProvider } from './theme-provider'

const BASE = 'http://127.0.0.1:4517/api'

function renderShell(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const testRouter = createRouter({ routeTree, history })
  return render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={testRouter} />
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const isDark = () => document.documentElement.classList.contains('dark')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  vi.stubGlobal(
    'WebSocket',
    class {
      static OPEN = 1
      readyState = 1
      addEventListener() {}
      send() {}
      close() {}
    },
  )
  server.use(
    http.get(`${BASE}/health`, () =>
      HttpResponse.json({ status: 'ok', pid: 1, uptimeMs: 1, activeRuns: 0, version: '0.1.0' }),
    ),
    http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })),
  )
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('ModeToggle in the shell', () => {
  test('switches the document theme class end-to-end', async () => {
    const user = userEvent.setup()
    renderShell('/')
    await screen.findByTestId('app-shell')

    expect(isDark()).toBe(false)

    await user.click(screen.getByTestId('mode-toggle'))
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }))

    expect(isDark()).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  test('the selection survives a remount', async () => {
    const user = userEvent.setup()
    const first = renderShell('/')
    await screen.findByTestId('app-shell')

    await user.click(screen.getByTestId('mode-toggle'))
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }))
    expect(isDark()).toBe(true)

    // Remount a fresh app tree: persisted choice should rehydrate.
    first.unmount()
    document.documentElement.classList.remove('dark') // prove the class is re-applied, not residual
    renderShell('/')
    await screen.findByTestId('app-shell')

    expect(isDark()).toBe(true)
  })
})
