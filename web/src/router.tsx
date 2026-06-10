import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppShell } from './app/AppShell'
import { RunsTable } from './features/dashboard/RunsTable'
import { StartRunForm } from './features/start-run/StartRunForm'
import { RunView } from './features/run-view/RunView'
import { WorkflowList } from './features/workflows/WorkflowList'
import { WorkflowEditor } from './features/workflows/WorkflowEditor'
import { useWorkflow } from './features/workflows/useWorkflow'
import {
  workflowDocToFormData,
} from './features/workflows/WorkflowDraftSchema'
import { useCwdStore } from './stores/cwd-store'
import { parseStatus, type RunStatus, type WorkflowScope } from './lib/api/types'

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
  // Dashboard status filter lives in the URL (ADR-003); unknown values coerce to no filter.
  validateSearch: (search: Record<string, unknown>): { status?: RunStatus } => ({
    status: parseStatus(search.status),
  }),
  component: RunsTable,
})

const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/start',
  component: StartRunForm,
})

const workflowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows',
  component: WorkflowList,
})

const newWorkflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/new',
  // `from` seeds a duplicate; `scope` says which scope to copy that source from
  // so duplicating a global workflow reads the global document (mirrors the edit
  // route below). Absent/unknown scope coerces to "project" for plain creates.
  validateSearch: (
    search: Record<string, unknown>,
  ): { from?: string; scope: WorkflowScope } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
    scope: search.scope === 'global' ? 'global' : 'project',
  }),
  component: NewWorkflowPage,
})

const editWorkflowRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workflows/$name/edit',
  // The list row carries its scope into the edit action (task_06); an unknown
  // or absent value coerces to "project" for back-compat. task_07 threads this
  // into useWorkflow(name, scope) and the read-only scope badge.
  validateSearch: (search: Record<string, unknown>): { scope: WorkflowScope } => ({
    scope: search.scope === 'global' ? 'global' : 'project',
  }),
  component: EditWorkflowPage,
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

function NewWorkflowPage() {
  const { from, scope } = newWorkflowRoute.useSearch()
  const activeCwd = useCwdStore(state => state.activeCwd())
  const { data: sourceDoc, isLoading } = useWorkflow(from, scope)

  if (from && activeCwd && isLoading) {
    return (
      <div data-testid="workflow-loading" className="text-center py-8 text-muted-foreground">
        Loading workflow…
      </div>
    )
  }

  const initialValues =
    from && sourceDoc ? workflowDocToFormData(sourceDoc, '') : undefined

  return <WorkflowEditor mode="create" initialValues={initialValues} />
}

function EditWorkflowPage() {
  const { name } = editWorkflowRoute.useParams()
  const { scope } = editWorkflowRoute.useSearch()
  const activeCwd = useCwdStore(state => state.activeCwd())
  const { data: workflowDoc, isLoading, isError } = useWorkflow(name, scope)

  if (activeCwd && isLoading) {
    return (
      <div data-testid="workflow-loading" className="text-center py-8 text-muted-foreground">
        Loading workflow…
      </div>
    )
  }

  if (activeCwd && (isError || !workflowDoc)) {
    return (
      <div data-testid="workflow-not-found" className="text-center py-8 text-destructive">
        Workflow not found.
      </div>
    )
  }

  return (
    <WorkflowEditor
      mode="edit"
      existingName={name}
      scope={scope}
      initialValues={workflowDoc ? workflowDocToFormData(workflowDoc) : undefined}
    />
  )
}

export const routeTree = rootRoute.addChildren([
  indexRoute,
  startRoute,
  workflowsRoute,
  newWorkflowRoute,
  editWorkflowRoute,
  runRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
