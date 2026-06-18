import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * In Prisma 7 the datasource connection URL lives here (used by `prisma generate`,
 * `db push`, `migrate`, `studio`) instead of inside schema.prisma.
 *
 * This URL is for DEVELOPMENT TOOLING ONLY. It points at the same dev database
 * the app uses in development (project-root `prisma/dev.db`). The packaged app
 * never reads this file — it resolves its own per-user DB path at runtime in
 * src/main/db/client.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: 'file:./prisma/dev.db'
  }
})
