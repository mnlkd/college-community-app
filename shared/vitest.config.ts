import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['@hilcoe/source'] },
  ssr: { resolve: { conditions: ['@hilcoe/source'] } },
  test: { include: ['test/**/*.test.ts'] },
})
