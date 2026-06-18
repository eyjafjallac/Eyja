import type { CreateMemoInput, Memo, MemoColor, UpdateMemoInput } from '@shared/models'
import { getPrisma } from './client'

/**
 * Memo repository — the ONLY module that touches Prisma for sticky memos.
 *
 * Mirrors note.repository: it maps Prisma rows into the wire-safe `Memo` domain
 * model (Date -> ISO string, the flat x/y/w/h columns -> a `bounds` object) so
 * the renderer never sees a Prisma type or a half-set of nullable coordinates.
 */

type PrismaMemo = Awaited<ReturnType<ReturnType<typeof getPrisma>['memo']['findFirstOrThrow']>>

function toDomain(row: PrismaMemo): Memo {
  // Bounds are all-or-nothing: only expose them once a full set is stored.
  const hasBounds =
    row.x !== null && row.y !== null && row.width !== null && row.height !== null
  return {
    id: row.id,
    content: row.content,
    color: row.color as MemoColor,
    pinned: row.pinned,
    bounds: hasBounds
      ? { x: row.x!, y: row.y!, width: row.width!, height: row.height! }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export const memoRepository = {
  async list(): Promise<Memo[]> {
    const rows = await getPrisma().memo.findMany({ orderBy: { updatedAt: 'desc' } })
    return rows.map(toDomain)
  },

  async get(id: string): Promise<Memo | null> {
    const row = await getPrisma().memo.findUnique({ where: { id } })
    return row ? toDomain(row) : null
  },

  async create(input: CreateMemoInput): Promise<Memo> {
    const row = await getPrisma().memo.create({
      data: { content: input.content ?? '', color: input.color ?? 'amber' }
    })
    return toDomain(row)
  },

  async update(input: UpdateMemoInput): Promise<Memo> {
    const { id, bounds, ...changes } = input
    const row = await getPrisma().memo.update({
      where: { id },
      data: {
        ...(changes.content !== undefined ? { content: changes.content } : {}),
        ...(changes.color !== undefined ? { color: changes.color } : {}),
        ...(changes.pinned !== undefined ? { pinned: changes.pinned } : {}),
        ...(bounds
          ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
          : {})
      }
    })
    return toDomain(row)
  },

  async delete(id: string): Promise<void> {
    await getPrisma().memo.delete({ where: { id } })
  }
}
