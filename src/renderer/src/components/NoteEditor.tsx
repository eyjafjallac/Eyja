import { useEffect, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import type { Note } from '@shared/models'
import { Button } from '@/components/ui/button'

interface NoteEditorProps {
  note: Note
  onSave: (id: string, fields: { title?: string; content?: string }) => void
  onDelete: (id: string) => void
}

/**
 * Main editing pane. For now it's a plain title + textarea so we can prove the
 * full read/write round-trip through the IPC bridge end to end.
 *
 * NEXT STEP: this textarea is the seam where the TipTap block editor (Markdown,
 * LaTeX, drag-and-drop images, the "/" slash menu) will drop in. `content` will
 * then hold serialized TipTap JSON instead of raw text.
 */
export function NoteEditor({ note, onSave, onDelete }: NoteEditorProps): JSX.Element {
  const [title, setTitle] = useState(note.title)
  const [content, setContent] = useState(note.content)

  // Re-sync local state when the selected note changes.
  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
  }, [note.id, note.title, note.content])

  const dirty = title !== note.title || content !== note.content

  return (
    <section className="flex h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-6 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
        />
        <Button size="sm" disabled={!dirty} onClick={() => onSave(note.id, { title, content })}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(note.id)} title="Delete note">
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start writing… (the TipTap block editor lands here next)"
        className="flex-1 resize-none bg-transparent px-6 py-4 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      <footer className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
        Last updated {new Date(note.updatedAt).toLocaleString()}
      </footer>
    </section>
  )
}
