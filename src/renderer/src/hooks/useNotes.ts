import { useCallback, useEffect, useState } from 'react'
import type { Note } from '@shared/models'

/**
 * Encapsulates all note data-access for the UI. Components call this hook and
 * never touch `window.api` directly, so the IPC surface stays in one place and
 * is trivial to later swap for React Query / optimistic updates.
 */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setNotes(await window.api.notes.list())
  }, [])

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  const createNote = useCallback(async () => {
    const note = await window.api.notes.create({ title: 'Untitled' })
    await refresh()
    return note
  }, [refresh])

  const saveNote = useCallback(
    async (id: string, fields: { title?: string; content?: string }) => {
      const updated = await window.api.notes.update({ id, ...fields })
      await refresh()
      return updated
    },
    [refresh]
  )

  const deleteNote = useCallback(
    async (id: string) => {
      await window.api.notes.delete(id)
      await refresh()
    },
    [refresh]
  )

  return { notes, loading, refresh, createNote, saveNote, deleteNote }
}
