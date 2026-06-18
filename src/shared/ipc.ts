import type { CreateNoteInput, Note, UpdateNoteInput } from './models'

/**
 * The IPC contract. This is the single source of truth shared by main + preload
 * + renderer, so a typo or signature change is a COMPILE error on both sides.
 *
 * Convention: channels are namespaced "<domain>:<action>" to stay collision-free
 * as the app grows (notes, tags, widgets, sticky-window, ...).
 */
export const IPC = {
  notes: {
    list: 'notes:list',
    get: 'notes:get',
    create: 'notes:create',
    update: 'notes:update',
    delete: 'notes:delete'
  }
} as const

/**
 * The surface exposed to the renderer as `window.api`.
 *
 * Every method returns a Promise because it round-trips to the main process via
 * `ipcRenderer.invoke`. The renderer treats this exactly like an async SDK and
 * never knows (or cares) that a database lives on the other side.
 */
export interface EyjaApi {
  notes: {
    list: () => Promise<Note[]>
    get: (id: string) => Promise<Note | null>
    create: (input: CreateNoteInput) => Promise<Note>
    update: (input: UpdateNoteInput) => Promise<Note>
    delete: (id: string) => Promise<void>
  }
}
