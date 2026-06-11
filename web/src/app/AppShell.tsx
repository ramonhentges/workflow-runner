import { Link, Outlet } from '@tanstack/react-router'
import { CwdSwitcher } from '@/features/cwd/CwdSwitcher'
import { useHealth } from '@/features/health/useHealth'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { ModeToggle } from '@/components/mode-toggle'
import { useCwdStore } from '@/stores/cwd-store'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', exact: true },
  { to: '/start', label: 'Start Run', exact: false },
  { to: '/workflows', label: 'Workflows', exact: false },
] as const

function DaemonStatus() {
  const { isSuccess, isError } = useHealth()
  const dot = isSuccess
    ? 'bg-status-completed'
    : isError
      ? 'bg-status-failed'
      : 'bg-muted-foreground/40'
  const label = isSuccess ? 'Daemon online' : isError ? 'Daemon offline' : 'Connecting…'

  return (
    <span className="flex items-center gap-1.5" title={label} aria-label={label}>
      <span className={`size-2 rounded-full ${dot}`} data-testid="daemon-status-dot" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  )
}

function WorkingDirLabel() {
  const activeCwd = useCwdStore(state => state.activeCwd())
  if (!activeCwd) return null

  return (
    <span
      className="truncate text-sm text-muted-foreground"
      title={activeCwd.path}
      data-testid="working-dir-label"
    >
      {activeCwd.label}
    </span>
  )
}

export function AppShell() {
  return (
    <SidebarProvider data-testid="app-shell">
      <Sidebar collapsible="icon" variant="inset" data-testid="app-sidebar">
        <SidebarHeader>
          <div className="flex items-center justify-between gap-2 px-2 py-1 group-data-[collapsible=icon]:justify-center">
            <span className="font-semibold text-sm group-data-[collapsible=icon]:hidden">
              Workflow Runner
            </span>
            <DaemonStatus />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map(item => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild tooltip={item.label}>
                      <Link
                        to={item.to}
                        activeOptions={item.exact ? { exact: true } : undefined}
                        activeProps={{ 'data-active': 'true' }}
                      >
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <CwdSwitcher />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <WorkingDirLabel />
          {/* Header action slot — ModeToggle mounts here (Task 9). */}
          <div className="ml-auto flex items-center gap-2" data-testid="header-actions">
            <ModeToggle />
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
