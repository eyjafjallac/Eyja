import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { CreateNoteInput, UpdateNoteInput } from '@shared/models'
import { noteRepository } from '../db/note.repository'

/**
 * Wires the `notes:*` IPC channels to the note repository.
 *
 * WHY handlers are this thin: keeping zero business logic here means the
 * security boundary (what the renderer can trigger) is trivial to audit, and
 * the actual data logic stays testable in the repository without Electron.
 *
 * We use `ipcMain.handle` (request/response) rather than `on`/`send` so the
 * renderer gets a clean Promise and errors propagate back automatically.
 */
export function registerNoteIpc(): void {
  ipcMain.handle(IPC.notes.list, () => noteRepository.list())

  ipcMain.handle(IPC.notes.get, (_event, id: string) => noteRepository.get(id))

  ipcMain.handle(IPC.notes.create, (_event, input: CreateNoteInput) =>
    noteRepository.create(input)
  )

  ipcMain.handle(IPC.notes.update, (_event, input: UpdateNoteInput) =>
    noteRepository.update(input)
  )

  ipcMain.handle(IPC.notes.delete, (_event, id: string) => noteRepository.delete(id))
}
