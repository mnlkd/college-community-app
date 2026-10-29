import { existsSync } from 'node:fs'
import { defineConfig } from 'prisma/config'

if (existsSync('.env')) process.loadEnvFile('.env')

// DATABASE_URL is needed only by commands that reach the database (migrate, studio);
// `prisma generate` works without it.
export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
})
