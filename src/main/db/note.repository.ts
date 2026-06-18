import type { CreateNoteInput, Note, UpdateNoteInput } from '@shared/models'
import { getPrisma } from './client'

/**
 * Note repository — the ONLY module that touches Prisma for notes.
 *
 * WHY this layer exists:
 *  - It maps Prisma rows (with `Date` objects and DB-specific shapes) into the
 *    plain, serializable `Note` domain model that crosses IPC. The renderer
 *    therefore never sees a Prisma type.
 *  - IPC handlers stay tiny: they just call these functions. Swapping the
 *    storage engine later means rewriting this file and nothing else.
 */

// Always fetch tags with a note so the UI gets a complete object in one call.
const withTags = { tags: true } as const

/** Internal: Prisma row -> wire-safe domain model (Date -> ISO string). */
type PrismaNote = Awaited<ReturnType<ReturnType<typeof getPrisma>['note']['findFirstOrThrow']>> & {
  tags: { id: string; name: string; color: string | null }[]
}

function toDomain(row: PrismaNote): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tags: row.tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
  }
}

export const noteRepository = {
  async list(): Promise<Note[]> {
    const rows = await getPrisma().note.findMany({
      include: withTags,
      orderBy: { updatedAt: 'desc' }
    })
    return rows.map(toDomain)
  },

  async get(id: string): Promise<Note | null> {
    const row = await getPrisma().note.findUnique({ where: { id }, include: withTags })
    return row ? toDomain(row) : null
  },

  async create(input: CreateNoteInput): Promise<Note> {
    const row = await getPrisma().note.create({
      data: { title: input.title, content: input.content ?? '' },
      include: withTags
    })
    return toDomain(row)
  },

  async update(input: UpdateNoteInput): Promise<Note> {
    const { id, ...changes } = input
    const row = await getPrisma().note.update({
      where: { id },
      // Spreading only defined keys keeps this a true partial update.
      data: {
        ...(changes.title !== undefined ? { title: changes.title } : {}),
        ...(changes.content !== undefined ? { content: changes.content } : {})
      },
      include: withTags
    })
    return toDomain(row)
  },

  async delete(id: string): Promise<void> {
    await getPrisma().note.delete({ where: { id } })
  }
}
