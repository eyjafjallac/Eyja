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
      <header className="flex items-center gap-2 border-b border-border px-6 py-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground"
        />

        <Button size="sm" disabled={!dirty} onClick={() => onSave(note.id, { title, content })}>
          <Save className="h-4 w-4" />
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onDelete(note.id)} title="Delete note">
          <Trash2 className="h-4 w-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1">
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

      <footer className="flex items-center justify-between border-t border-border px-6 py-2 text-xs text-muted-foreground">
        <span>
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
        <span>Last updated {new Date(note.updatedAt).toLocaleString()}</span>
      </footer>
    </section>
  )
}
