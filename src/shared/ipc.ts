import type {
  CreateMemoInput,
  CreateNoteInput,
  Memo,
  Note,
  SaveImageInput,
  UpdateMemoInput,
  UpdateNoteInput
} from './models'

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
  },
  images: {
    save: 'images:save'
  },
  memos: {
    list: 'memos:list',
    get: 'memos:get',
    create: 'memos:create',
    update: 'memos:update',
    delete: 'memos:delete'
  },
  // Window-management channels (open/close the floating sticky window).
  memoWindow: {
    open: 'memoWindow:open',
    close: 'memoWindow:close'
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
  images: {
    /** Persists image bytes and returns an `eyja-asset://` URL to embed. */
    save: (input: SaveImageInput) => Promise<string>
  }
  memos: {
    list: () => Promise<Memo[]>
    get: (id: string) => Promise<Memo | null>
    create: (input: CreateMemoInput) => Promise<Memo>
    update: (input: UpdateMemoInput) => Promise<Memo>
    delete: (id: string) => Promise<void>
  }
  memoWindow: {
    /** Open (or focus) the floating window for a memo. */
    open: (id: string) => Promise<void>
    /** Close the floating window for a memo (the memo itself is kept). */
    close: (id: string) => Promise<void>
  }
}
