import { FileText, Plus } from 'lucide-react'
import type { Note } from '@shared/models'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface SidebarProps {
  notes: Note[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

/**
 * Left navigation pane: the note list + a "new note" action. Presentational
 * only — it receives data and callbacks, so it has no idea IPC/SQLite exist.
 */
export function Sidebar({ notes, selectedId, onSelect, onCreate }: SidebarProps): JSX.Element {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tracking-wide text-muted-foreground">EYJA</span>
        <Button size="icon" variant="ghost" onClick={onCreate} title="New note">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {notes.length === 0 ? (
          <p className="px-2 py-4 text-xs text-muted-foreground">
            No notes yet. Create one to get started.
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
    </aside>
  )
}
