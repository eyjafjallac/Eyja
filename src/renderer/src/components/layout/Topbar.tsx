import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { MemoLauncher } from '@/components/memo/MemoLauncher'

interface TopbarProps {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
}

/**
 * Slim chrome at the top of the main pane. It stays visible regardless of
 * sidebar state, so the sidebar collapse/expand control and global actions
 * (theme) always have a stable home — instead of disappearing with the sidebar.
 */
export function Topbar({ sidebarCollapsed, onToggleSidebar }: TopbarProps): JSX.Element {
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
      <Button
        size="icon"
        variant="ghost"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen className="h-4 w-4" />
        ) : (
          <PanelLeftClose className="h-4 w-4" />
        )}
      </Button>

      <div className="flex items-center gap-1">
        <MemoLauncher />
        <ThemeToggle />
      </div>
    </header>
  )
}
