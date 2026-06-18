import { useMemo, useState, type ReactNode } from 'react'
import type { Note } from '@shared/models'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Sidebar } from '@/components/Sidebar'
import { SplitPane } from './SplitPane'
import { Topbar } from './Topbar'

interface AppLayoutProps {
  notes: Note[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  /** Main-pane content (the editor or an empty state). */
  children: ReactNode
}

/**
 * The app frame: [ Sidebar | Topbar + content ].
 *
 * It owns *layout* state only — sidebar collapse and the search query — leaving
 * note data and selection to App/useNotes. Search filtering happens here so the
 * Sidebar can stay a dumb presentational list.
 */
export function AppLayout({
  notes,
  selectedId,
  onSelect,
  onCreate,
  children
}: AppLayoutProps): JSX.Element {
  const [collapsed, setCollapsed] = usePersistentState<boolean>('eyja.sidebar.collapsed', false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q))
  }, [notes, search])

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <SplitPane
        storageKey="eyja.sidebar.width"
        collapsed={collapsed}
        left={
          <Sidebar
            notes={filtered}
            selectedId={selectedId}
            search={search}
            onSearchChange={setSearch}
            onSelect={onSelect}
            onCreate={onCreate}
          />
        }
        right={
          <div className="flex h-full flex-col">
            <Topbar
              sidebarCollapsed={collapsed}
              onToggleSidebar={() => setCollapsed(!collapsed)}
            />
            <div className="min-h-0 flex-1">{children}</div>
          </div>
        }
      />
    </div>
  )
}
