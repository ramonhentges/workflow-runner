import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse, delay } from 'msw'
import { server } from '../../test/setup'
import { routeTree } from '../router'
import { useCwdStore } from '@/stores/cwd-store'
import { ThemeProvider } from '@/components/theme-provider'

const BASE = 'http://127.0.0.1:4517'

const okHealth = {
  status: 'ok',
  pid: 1234,
  uptimeMs: 5000,
  activeRuns: 0,
  version: '0.1.0',
}

function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  // Stub the global WebSocket so any run-view mounts during navigation are inert.
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
    http.get(`${BASE}/health`, () => HttpResponse.json(okHealth)),
    http.get(`${BASE}/runs`, () => HttpResponse.json({ runs: [] })),
  )
})

// ─── Shell structure ──────────────────────────────────────────────────────────

describe('AppShell structure', () => {
  test('renders the app-shell and app-sidebar containers', async () => {
    renderApp('/')
    expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
  })

  test('reserves a header action slot for the future mode toggle', async () => {
    renderApp('/')
    expect(await screen.findByTestId('header-actions')).toBeInTheDocument()
  })

  test('renders the Outlet content region for the active route', async () => {
    renderApp('/')
    // Dashboard with no active cwd renders its no-cwd state inside the Outlet.
    expect(await screen.findByTestId('no-cwd-state')).toBeInTheDocument()
  })
})

// ─── Navigation links ───────────────────────────────────────────────────────

describe('AppShell navigation', () => {
  test('renders the three nav links pointing to /, /start, /workflows', async () => {
    renderApp('/')
    const dashboard = await screen.findByRole('link', { name: 'Dashboard' })
    expect(dashboard).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Start Run' })).toHaveAttribute('href', '/start')
    expect(screen.getByRole('link', { name: 'Workflows' })).toHaveAttribute(
      'href',
      '/workflows',
    )
  })

  test('marks the link for the current route as active', async () => {
    renderApp('/workflows')
    const workflows = await screen.findByRole('link', { name: 'Workflows' })
    expect(workflows).toHaveAttribute('data-active', 'true')
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'data-active',
      'false',
    )
  })

  test('navigating swaps the Outlet content while the sidebar persists', async () => {
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByTestId('app-sidebar')
    expect(await screen.findByTestId('no-cwd-state')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Workflows' }))

    // Outlet swapped to the workflows view…
    expect(await screen.findByTestId('no-cwd-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('no-cwd-state')).not.toBeInTheDocument()
    // …and the sidebar is still mounted.
    expect(screen.getByTestId('app-sidebar')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workflows' })).toHaveAttribute(
      'data-active',
      'true',
    )
  })
})

// ─── Daemon status indicator ────────────────────────────────────────────────

describe('AppShell daemon status', () => {
  test('renders the daemon-status-dot inside the sidebar with the online label', async () => {
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    expect(within(screen.getByTestId('app-sidebar')).getByTestId('daemon-status-dot')).toBe(dot)
    await waitFor(() =>
      expect(dot.parentElement).toHaveAttribute('aria-label', 'Daemon online'),
    )
  })

  test('shows the offline label when the daemon is unreachable', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.json({}, { status: 503 })))
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    await waitFor(() =>
      expect(dot.parentElement).toHaveAttribute('aria-label', 'Daemon offline'),
    )
  })

  test('shows the connecting label while the health request is pending', async () => {
    server.use(
      http.get(`${BASE}/health`, async () => {
        await delay('infinite')
        return HttpResponse.json(okHealth)
      }),
    )
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    expect(dot.parentElement).toHaveAttribute('aria-label', 'Connecting…')
  })

  // Issue 004: the dot must consume semantic status tokens, not raw palette
  // shades (no bg-green-500 / bg-red-500), so it stays themed per light/dark.
  test('colors the online dot with the semantic status-completed token', async () => {
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    await waitFor(() =>
      expect(dot.parentElement).toHaveAttribute('aria-label', 'Daemon online'),
    )
    expect(dot).toHaveClass('bg-status-completed')
    expect(dot.className).not.toMatch(/bg-(green|red)-\d/)
  })

  test('colors the offline dot with the semantic status-failed token', async () => {
    server.use(http.get(`${BASE}/health`, () => HttpResponse.json({}, { status: 503 })))
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    await waitFor(() =>
      expect(dot.parentElement).toHaveAttribute('aria-label', 'Daemon offline'),
    )
    expect(dot).toHaveClass('bg-status-failed')
    expect(dot.className).not.toMatch(/bg-(green|red)-\d/)
  })

  test('colors the connecting dot with the semantic muted-foreground token', async () => {
    server.use(
      http.get(`${BASE}/health`, async () => {
        await delay('infinite')
        return HttpResponse.json(okHealth)
      }),
    )
    renderApp('/')
    const dot = await screen.findByTestId('daemon-status-dot')
    expect(dot.parentElement).toHaveAttribute('aria-label', 'Connecting…')
    expect(dot).toHaveClass('bg-muted-foreground/40')
    expect(dot.className).not.toMatch(/bg-(green|red)-\d/)
  })
})

// ─── CwdSwitcher placement ──────────────────────────────────────────────────

describe('AppShell cwd switcher', () => {
  test('renders the cwd switcher inside the shell and reflects the active selection', async () => {
    useCwdStore.setState({
      cwds: [
        { id: 'a', label: 'Proj A', path: '/p/a' },
        { id: 'b', label: 'Proj B', path: '/p/b' },
      ],
      activeCwdId: 'a',
    })
    const user = userEvent.setup()
    renderApp('/')
    await screen.findByTestId('app-shell')

    const selector = screen.getByRole('combobox', { name: 'Active working directory' })
    expect(selector).toHaveTextContent('Proj A')

    await user.click(selector)
    await user.click(await screen.findByRole('option', { name: /Proj B/ }))

    expect(useCwdStore.getState().activeCwdId).toBe('b')
    expect(selector).toHaveTextContent('Proj B')
  })
})
