import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type EyjaApi } from '@shared/ipc'
import type { CreateNoteInput, UpdateNoteInput } from '@shared/models'

/**
 * The bridge. This file is deliberately the SMALLEST, dumbest layer in the app:
 * it owns no logic, only a 1:1 mapping from a friendly method to an IPC channel.
 *
 * WHY: with `contextIsolation: true`, the renderer cannot reach Node or the DB.
 * Its entire capability set is exactly what we hand it here via `contextBridge`.
 * Keeping this declarative makes the security surface auditable at a glance.
 *
 * `ipcRenderer.invoke` is request/response: each call returns a Promise that
 * resolves with the main-process handler's return value (or rejects on error).
 */
const api: EyjaApi = {
  notes: {
    list: () => ipcRenderer.invoke(IPC.notes.list),
    get: (id: string) => ipcRenderer.invoke(IPC.notes.get, id),
    create: (input: CreateNoteInput) => ipcRenderer.invoke(IPC.notes.create, input),
    update: (input: UpdateNoteInput) => ipcRenderer.invoke(IPC.notes.update, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.notes.delete, id)
  }
}

// Expose as `window.api` in the isolated renderer world. Nothing else leaks.
contextBridge.exposeInMainWorld('api', api)
