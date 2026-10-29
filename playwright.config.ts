import { defineConfig, devices } from '@playwright/test'

// End-to-end use-case tests against the dev API (server/.env) and the Vite client (client/.env).
// They sign in to the configured Supabase project with the seeded accounts, so run `npm run db:seed` first.
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined)

export default defineConfig({
  testDir: './e2e',
  // The NFR-4 load check runs against production builds: npm run e2e:load.
  testIgnore: ['load/**'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
  },
  webServer: [
    {
      command: 'npm run dev -w server',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev -w client',
      url: 'http://localhost:5173/login',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
