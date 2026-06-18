import { useEffect, useState } from 'react'
import { useNotes } from '@/hooks/useNotes'
import { Sidebar } from '@/components/Sidebar'
import { NoteEditor } from '@/components/NoteEditor'

/**
 * App shell: the split-pane layout (Sidebar | editor) you asked for in Step 2,
 * here wired to the database purely through `window.api` to prove the bridge
 * works end-to-end. No Node, no SQL, no Prisma types anywhere in this tree.
 */
export default function App(): JSX.Element {
  const { notes, loading, createNote, saveNote, deleteNote } = useNotes()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Keep a valid selection: pick the first note, or clear if none remain.
  useEffect(() => {
    if (selectedId && notes.some((n) => n.id === selectedId)) return
    setSelectedId(notes[0]?.id ?? null)
  }, [notes, selectedId])

  const selected = notes.find((n) => n.id === selectedId) ?? null

  const handleCreate = async (): Promise<void> => {
    const note = await createNote()
    setSelectedId(note.id)
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        notes={notes}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreate={handleCreate}
      />

      <main className="flex flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : selected ? (
          <NoteEditor note={selected} onSave={saveNote} onDelete={deleteNote} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 text-muted-foreground">
            <p className="text-sm">Select a note, or create your first one.</p>
          </div>
        )}
      </main>
    </div>
  )
}
