import { Link, Outlet } from '@tanstack/react-router'
import { CwdSwitcher } from '@/features/cwd/CwdSwitcher'
import { useHealth } from '@/features/health/useHealth'

function DaemonStatus() {
  const { isSuccess, isError } = useHealth()
  const dot = isSuccess
    ? 'bg-green-500'
    : isError
      ? 'bg-red-500'
      : 'bg-muted-foreground/40'
  const label = isSuccess ? 'Daemon online' : isError ? 'Daemon offline' : 'Connecting…'

  return (
    <span className="flex items-center gap-1.5" title={label} aria-label={label}>
      <span className={`size-2 rounded-full ${dot}`} data-testid="daemon-status-dot" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}

export function AppShell() {
  return (
    <div className="flex h-screen" data-testid="app-shell">
      <aside
        className="w-64 shrink-0 border-r flex flex-col overflow-hidden"
        data-testid="app-sidebar"
      >
        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
          <span className="font-semibold text-sm">Workflow Runner</span>
          <DaemonStatus />
        </div>
        <nav className="flex flex-col gap-1 p-2" aria-label="Main">
          <Link
            to="/"
            activeOptions={{ exact: true }}
            className="px-3 py-2 rounded text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            activeProps={{ className: 'bg-accent font-medium text-accent-foreground' }}
          >
            Dashboard
          </Link>
          <Link
            to="/start"
            className="px-3 py-2 rounded text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
            activeProps={{ className: 'bg-accent font-medium text-accent-foreground' }}
          >
            Start Run
          </Link>
        </nav>
        <div className="flex-1 overflow-y-auto border-t">
          <CwdSwitcher />
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
