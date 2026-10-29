import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { testDatabaseUrl } from './test-env.js'

/** Brings the test schema up to date once per run; tables are emptied by each file. */
export default function setup(): void {
  let url: string
  try {
    url = testDatabaseUrl()
  } catch {
    return // Unit-only runs (no database) skip migration; integration files fail clearly instead.
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
}
