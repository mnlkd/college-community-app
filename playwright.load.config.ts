import { defineConfig, devices } from '@playwright/test'

// NFR-4 load check against the production builds: the compiled API (node dist) and the bundled
// client served by `vite preview`, which forwards /api like the Vercel rewrite. Set
// LOAD_BASE_URL to measure a deployed environment instead (no local servers are started).
const channel = process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'darwin' ? 'chrome' : undefined)
const remote = process.env.LOAD_BASE_URL

export default defineConfig({
  testDir: './e2e/load',
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: 'list',
  use: {
    baseURL: remote ?? 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    ...(channel ? { channel } : {}),
  },
  webServer: remote
    ? []
    : [
        {
          command: 'npm run build -w shared && npm run build -w server && PORT=4100 npm run start -w server',
          url: 'http://localhost:4100/api/health',
          reuseExistingServer: false,
          timeout: 180_000,
        },
        {
          command:
            'npm run build -w client && API_PROXY_TARGET=http://localhost:4100 npm run preview -w client',
          url: 'http://localhost:4173/login',
          reuseExistingServer: false,
          timeout: 180_000,
        },
      ],
})
