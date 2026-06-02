import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './app/AppShell'
import { RunsTable } from './features/dashboard/RunsTable'
import { StartRunForm } from './features/start-run/StartRunForm'
import { RunView } from './features/run-view/RunView'

function NotFound() {
  return (
    <div data-testid="not-found" className="text-center py-12 text-muted-foreground">
      <p className="text-lg font-medium">Page not found</p>
      <p className="text-sm mt-1">The page you are looking for does not exist.</p>
    </div>
  )
}

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: RunsTable,
})

const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/start',
  component: StartRunForm,
})

const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/runs/$runId',
  component: RunPage,
})

function RunPage() {
  const { runId } = runRoute.useParams()
  return <RunView runId={runId} />
}

export const routeTree = rootRoute.addChildren([indexRoute, startRoute, runRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
