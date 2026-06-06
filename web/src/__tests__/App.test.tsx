import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createRouter, createMemoryHistory } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { routeTree } from '../router'

function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const testRouter = createRouter({ routeTree, history })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider>,
  )
}

describe('App', () => {
  test('mounts the router and renders the app shell', async () => {
    renderApp('/')
    expect(await screen.findByTestId('app-shell')).toBeInTheDocument()
  })

  test('navigation links are present in the shell', async () => {
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start Run' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Workflows' })).toBeInTheDocument()
  })
})
