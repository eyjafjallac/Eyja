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
