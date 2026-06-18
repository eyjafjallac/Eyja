import { FileText, Plus, Search } from 'lucide-react'
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
  onCreate
}: SidebarProps): JSX.Element {
  return (
    <aside className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="px-1 text-sm font-semibold tracking-widest text-muted-foreground">
          EYJA
        </span>
        <Button size="icon" variant="ghost" onClick={onCreate} title="New note">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search notes…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {notes.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            {search ? 'No notes match your search.' : 'No notes yet. Create one to get started.'}
          </p>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              onClick={() => onSelect(note.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                selectedId === note.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground/80 hover:bg-accent/60'
              )}
            >
              <FileText className="h-4 w-4 shrink-0 opacity-70" />
              <span className="truncate">{note.title || 'Untitled'}</span>
            </button>
          ))
        )}
      </nav>

      <footer className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {notes.length} {notes.length === 1 ? 'note' : 'notes'}
      </footer>
    </aside>
  )
}
