import { join } from 'node:path'
import { app } from 'electron'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../../generated/prisma/client'

/**
 * Single, lazily-created Prisma client for the whole main process.
 *
 * WHY a driver adapter instead of Prisma's default engine:
 *  - The `@prisma/adapter-better-sqlite3` adapter makes Prisma talk to the
 *    `better-sqlite3` native module we already rebuild for Electron. That means
 *    ONE native binary to manage and no separate Prisma engine binary to unpack
 *    from the asar archive — a notorious Electron packaging pain point.
 */

/**
 * Decide where the SQLite file lives.
 *  - Dev: alongside the schema (`prisma/dev.db`) — the SAME file the Prisma CLI
 *    targets via prisma.config.ts, so `npm run db:push` and the app share one db.
 *  - Packaged: the per-user, writable `userData` directory, so every installed
 *    copy keeps its own notes and we never try to write inside the read-only app
 *    bundle.
 *
 * NOTE (next step): packaged builds still need the schema applied to this fresh
 * file. We'll add a Prisma migration-deploy bootstrap when we tackle the
 * migrations/packaging step; in development `db:push` already handles it.
 */
function resolveDatabaseUrl(): string {
  const dbPath = app.isPackaged
    ? join(app.getPath('userData'), 'eyja.db')
    : join(process.cwd(), 'prisma', 'dev.db')

  // better-sqlite3 only needs the filesystem path; the adapter strips "file:".
  return `file:${dbPath}`
}

let prismaClient: PrismaClient | null = null

/** Returns the shared PrismaClient, creating it on first use. */
export function getPrisma(): PrismaClient {
  if (!prismaClient) {
    const adapter = new PrismaBetterSqlite3({ url: resolveDatabaseUrl() })
    prismaClient = new PrismaClient({ adapter })
  }
  return prismaClient
}

/** Cleanly close the DB connection (call on app quit). */
export async function disconnectPrisma(): Promise<void> {
  if (prismaClient) {
    await prismaClient.$disconnect()
    prismaClient = null
  }
}
