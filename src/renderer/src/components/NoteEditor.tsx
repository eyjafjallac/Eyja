import { useEffect, useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import type { Note } from '@shared/models'
import { Button } from '@/components/ui/button'
import { BlockEditor } from '@/components/editor/BlockEditor'
import { extractText } from '@/lib/editor'

interface NoteEditorProps {
  note: Note
  onSave: (id: string, fields: { title?: string; content?: string }) => void
  onDelete: (id: string) => void
}

/**
 * Main editing pane: editable title + the TipTap block editor.
 *
 * The editor is WYSIWYG, so what you type is already what you see — no separate
 * preview/read modes needed. The note body stays an opaque string here, so the
 * DB/IPC layers are unaffected by TipTap living inside <BlockEditor>.
 */
export function NoteEditor({ note, onSave, onDelete }: NoteEditorProps): JSX.Element {
  const [title, setTitle] = useState(note.title)
  // `content` holds the serialized TipTap JSON; `text` is its flattened form.
  const [content, setContent] = useState(note.content)
  const [text, setText] = useState(() => extractText(note.content))

  // Re-sync the draft when a different note is selected or it's saved.
  useEffect(() => {
    setTitle(note.title)
    setContent(note.content)
    setText(extractText(note.content))
  }, [note.id, note.title, note.content])

  const dirty = title !== note.title || content !== note.content
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0

  return (
    <section className="flex h-full flex-col">
      <header className="flex items-center gap-4 px-6 py-4 glass-header shadow-sm transition-all relative z-10">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled Note"
          className="min-w-0 flex-1 bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:text-foreground/30 transition-all focus:placeholder:text-foreground/20"
        />

        <div className="flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity focus-within:opacity-100">
          <Button size="sm" variant="outline" className="h-8 rounded-full backdrop-blur-md bg-background/30 border-border/50 text-foreground shadow-sm px-3" disabled={!dirty} onClick={() => onSave(note.id, { title, content })}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            Save
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full hover:bg-destructive/10 text-foreground/60 hover:text-destructive transition-colors" onClick={() => onDelete(note.id)} title="Delete note">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 relative z-10">
        {/* key={note.id} → a fresh editor instance per note. */}
        <BlockEditor
          key={note.id}
          initialContent={note.content}
          editable
          onChange={(json, plain) => {
            setContent(json)
            setText(plain)
          }}
        />
      </div>

      <footer className="flex items-center justify-between glass-header px-6 py-2.5 text-xs text-foreground/60 border-t-white/10 mt-auto relative z-10">
        <div className="flex items-center gap-4">
          <span className="font-medium tracking-wide">
            {wordCount} {wordCount === 1 ? 'WORD' : 'WORDS'}
          </span>
        </div>
        <span className="opacity-80">Last updated {new Date(note.updatedAt).toLocaleString()}</span>
      </footer>
    </section>
  )
}
