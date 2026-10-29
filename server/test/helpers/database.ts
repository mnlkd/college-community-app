import type { PrismaClient } from '../../src/generated/prisma/client.js'

/** Empties every application table of the test schema. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const [{ schema } = { schema: '' }] = await prisma.$queryRaw<
    { schema: string }[]
  >`SELECT current_schema() AS schema`
  if (!schema.includes('test')) throw new Error(`Refusing to empty schema "${schema}"`)
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`
  if (tables.length === 0) return
  const list = tables.map((table) => `"${table.tablename}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`)
}
