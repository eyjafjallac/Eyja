/**
 * Domain models — the plain, serializable shapes that cross the IPC boundary.
 *
 * WHY these live in `shared/` and are hand-written (not Prisma's types):
 *  - Anything sent over IPC must be structured-clone friendly. We use ISO date
 *    strings instead of `Date`/`BigInt` so payloads are predictable everywhere.
 *  - The renderer must NOT depend on Prisma. Decoupling the wire format from the
 *    DB schema means we can change the database later without breaking the UI.
 *
 * The main-process repository is responsible for mapping Prisma rows <-> these.
 */

/** A tag used to categorize notes (e.g. "calculus", "to-review"). */
export interface Tag {
  id: string
  name: string
  /** Optional hex color for the UI chip, e.g. "#22c55e". */
  color: string | null
}

/** A single note/document. `content` holds the TipTap document as JSON text. */
export interface Note {
  id: string
  title: string
  /** Serialized TipTap JSON document. Empty string for a brand-new note. */
  content: string
  /** ISO-8601 timestamps. */
  createdAt: string
  updatedAt: string
  tags: Tag[]
}

/** Payload to create a note. The main process generates id/timestamps. */
export interface CreateNoteInput {
  title: string
  content?: string
}

/** Payload to update a note. Only provided fields are changed. */
export interface UpdateNoteInput {
  id: string
  title?: string
  content?: string
}

/**
 * Payload to persist an image. The renderer reads a dropped/pasted file into
 * raw bytes (Uint8Array is structured-clone friendly over IPC) and the main
 * process writes it to disk, returning an `eyja-asset://` URL to embed.
 */
export interface SaveImageInput {
  bytes: Uint8Array
  /** File extension without the dot, e.g. "png" (sanitized in main). */
  ext: string
}

/** Sticky-memo palette keys; mapped to concrete colors in the renderer. */
export type MemoColor = 'amber' | 'green' | 'blue' | 'pink' | 'purple'

/** Window position + size for a sticky memo, in screen pixels. */
export interface MemoBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A floating sticky memo. Lives in its own always-on-top window so quick notes
 * stay visible over other apps while studying.
 */
export interface Memo {
  id: string
  content: string
  color: MemoColor
  /** Whether the window floats above all others. */
  pinned: boolean
  /** Last known window bounds, or null before it has been placed. */
  bounds: MemoBounds | null
  createdAt: string
  updatedAt: string
}

/** Payload to create a memo. The main process generates id/timestamps. */
export interface CreateMemoInput {
  content?: string
  color?: MemoColor
}

/** Payload to update a memo. Only provided fields change. */
export interface UpdateMemoInput {
  id: string
  content?: string
  color?: MemoColor
  pinned?: boolean
  bounds?: MemoBounds
}
