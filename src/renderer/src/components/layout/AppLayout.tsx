import { useMemo, useState, useEffect, type ReactNode } from 'react'
import type { Note } from '@shared/models'
import { usePersistentState } from '@/hooks/usePersistentState'
import { Sidebar } from '@/components/Sidebar'
import { SplitPane } from './SplitPane'
import { Topbar } from './Topbar'
import { SettingsPanel } from '@/components/SettingsPanel'

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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editorOpacity, setEditorOpacity] = usePersistentState('eyja.editorOpacity', 40)
  const [sidebarOpacity, setSidebarOpacity] = usePersistentState('eyja.sidebarOpacity', 60)
  const [memoOpacity] = usePersistentState('eyja.memoOpacity', 100)

  // Apply transparency settings to CSS variables on the document root
  useEffect(() => {
    document.documentElement.style.setProperty('--editor-opacity', String(editorOpacity / 100))
    document.documentElement.style.setProperty('--sidebar-opacity', String(sidebarOpacity / 100))
  }, [editorOpacity, sidebarOpacity])
  
  useEffect(() => {
    // Force write to localStorage to ensure other windows can see it instantly
    window.localStorage.setItem('eyja.memoOpacity', JSON.stringify(memoOpacity))
  }, [memoOpacity])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q))
  }, [notes, search])

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent text-foreground relative">
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
            onOpenSettings={() => setSettingsOpen(true)}
          />
        }
        right={
          <div className="flex h-full flex-col glass-main">
            <Topbar
              sidebarCollapsed={collapsed}
              onToggleSidebar={() => setCollapsed(!collapsed)}
            />
            <div className="min-h-0 flex-1">{children}</div>
          </div>
        }
      />
      <SettingsPanel 
        open={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
        editorOpacity={editorOpacity}
        setEditorOpacity={setEditorOpacity}
        sidebarOpacity={sidebarOpacity}
        setSidebarOpacity={setSidebarOpacity}
      />
    </div>
  )
}
