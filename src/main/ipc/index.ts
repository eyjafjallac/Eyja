import { registerNoteIpc } from './note.ipc'
import { registerImageIpc } from './image.ipc'
import { registerMemoIpc } from './memo.ipc'

/**
 * Single entry point that registers every IPC domain. The main process calls
 * this once at startup. As features land (tags, widgets, sticky windows), add
 * their `register*Ipc()` here — one obvious place to see the full backend API.
 */
export function registerIpcHandlers(): void {
  registerNoteIpc()
  registerImageIpc()
  registerMemoIpc()
}
