import { FileText, Plus, Search, Settings } from 'lucide-react'
import type { Note } from '@shared/models'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface SidebarProps {
  notes: Note[]
  selectedId: string | null
  search: string
  onSearchChange: (value: string) => void
  onSelect: (id: string) => void
  onCreate: () => void
  onOpenSettings?: () => void
}

/**
 * Left navigation pane: brand, search, note list, count.
 *
 * Purely presentational — it receives the (already filtered) notes plus
 * callbacks and knows nothing about IPC/SQLite. That keeps it trivial to test
 * and reuse, and means all data logic stays in hooks/App.
 */
export function Sidebar({
  notes,
  selectedId,
  search,
  onSearchChange,
  onSelect,
  onCreate,
  onOpenSettings
}: SidebarProps): JSX.Element {
  return (
    <aside className="flex h-full flex-col glass-panel w-full">
      <div className="flex flex-col px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-3xl font-serif font-bold italic tracking-widest text-foreground drop-shadow-sm">
              EYJA
            </span>
            <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
          </div>
          <Button size="icon" variant="ghost" onClick={onCreate} title="New note" className="h-6 w-6 rounded-full hover:bg-transparent text-primary hover:text-primary/80 transition-all">
            <Plus className="h-5 w-5" />
          </Button>
        </div>
        <span className="text-[9px] font-medium tracking-[0.2em] text-foreground/50 uppercase mt-1">
          Home away from home
        </span>
      </div>

      <div className="px-5 pb-6 mt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/40" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="h-9 pl-9 text-xs rounded-xl bg-foreground/5 border-none ring-0 shadow-none text-foreground placeholder:text-foreground/40 transition-all focus:bg-foreground/10"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {notes.length === 0 ? (
          <p className="px-4 py-4 text-xs text-foreground/40">
            {search ? 'No notes match your search.' : 'No notes yet. Create one to get started.'}
          </p>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              onClick={() => onSelect(note.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-left text-sm transition-all',
                selectedId === note.id
                  ? 'bg-foreground/10 text-foreground font-medium'
                  : 'text-foreground/70 hover:bg-foreground/5 hover:text-foreground'
              )}
            >
              <FileText className={cn("h-4 w-4 shrink-0 transition-colors", selectedId === note.id ? "text-primary" : "text-primary/60")} />
              <div className="flex flex-col overflow-hidden w-full">
                <span className="truncate">{note.title || 'Untitled'}</span>
              </div>
            </button>
          ))
        )}
      </nav>

      <footer className="px-4 py-4 mt-auto border-t border-white/10">
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onOpenSettings} 
            className="h-8 w-8 rounded-full hover:bg-foreground/10 text-foreground/70 hover:text-foreground transition-colors"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground/5 text-[10px] font-bold tracking-widest text-foreground/50 uppercase">
            <span>Notes</span>
            <span className="text-primary">{notes.length}</span>
          </div>
        </div>
      </footer>
    </aside>
  )
}
