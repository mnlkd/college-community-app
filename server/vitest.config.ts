import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['@hilcoe/source'] },
  ssr: { resolve: { conditions: ['@hilcoe/source'] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Integration files share one test schema, so they run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
