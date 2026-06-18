import { useEffect } from 'react'
import { useNotes } from '@/hooks/useNotes'
import { usePersistentState } from '@/hooks/usePersistentState'
import { AppLayout } from '@/components/layout/AppLayout'
import { NoteEditor } from '@/components/NoteEditor'

/**
 * App = data + selection. All *layout* concerns live in <AppLayout>; this
 * component just owns which note is active and renders the right main-pane
 * content for it. Nothing here knows about Node, SQL, or Prisma — only
 * `window.api` via the useNotes hook.
 */
export default function App(): JSX.Element {
  const { notes, loading, createNote, saveNote, deleteNote } = useNotes()
  // Remember the last-open note across restarts (UI state, not DB).
  const [selectedId, setSelectedId] = usePersistentState<string | null>('eyja.selectedNote', null)

  // Keep the selection valid: fall back to the first note, or clear if none.
  useEffect(() => {
    if (selectedId && notes.some((n) => n.id === selectedId)) return
    setSelectedId(notes[0]?.id ?? null)
  }, [notes, selectedId, setSelectedId])

  const selected = notes.find((n) => n.id === selectedId) ?? null

  const handleCreate = async (): Promise<void> => {
    const note = await createNote()
    setSelectedId(note.id)
  }

  return (
    <AppLayout
      notes={notes}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onCreate={handleCreate}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : selected ? (
        <NoteEditor note={selected} onSave={saveNote} onDelete={deleteNote} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <p className="text-sm">Select a note, or create your first one.</p>
        </div>
      )}
    </AppLayout>
  )
}
