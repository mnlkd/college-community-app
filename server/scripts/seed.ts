/**
 * Demonstration seed (NFR-9): the ten synthetic identities and the sample content.
 *
 *   npm run db:seed -w server     idempotent: restores the demonstration accounts and content
 *   npm run db:reseed -w server   erases all platform data first (DEMO_ENVIRONMENT=true only)
 *
 * Needs server/.env with SEED_PASSWORD.
 */
import { passwordSchema } from '@hilcoe/shared'
import { loadConfig } from '../src/infrastructure/config.js'
import { DemoSeeder, SupabaseDemoAdmin } from '../src/infrastructure/demo-seeder.js'
import { createPrismaClient } from '../src/infrastructure/prisma.js'
import { systemClock } from '../src/kernel/index.js'

const config = loadConfig()
const password = passwordSchema.parse(process.env.SEED_PASSWORD ?? '')
const prisma = createPrismaClient({ databaseUrl: config.databaseUrl, sslCaFile: config.databaseSslCaFile })
const admin = new SupabaseDemoAdmin(
  { supabaseUrl: config.supabaseUrl, serviceRoleKey: config.supabaseServiceRoleKey },
  prisma,
)
const seeder = new DemoSeeder({
  db: prisma,
  clock: systemClock,
  auth: admin,
  storage: admin,
  password,
  demoEnvironment: config.demoEnvironment,
})

try {
  const summary = process.argv.includes('--reseed') ? await seeder.reseed() : await seeder.seed()
  console.log('Seeded:', JSON.stringify(summary))
} catch (error) {
  console.error('Seed failed:', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
