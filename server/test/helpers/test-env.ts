import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfig, type AppConfig } from '../../src/infrastructure/config.js'

const envFile = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

/** The test database URL; refuses to run against the development schema. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see server/.env.example)')
  const schema = new URL(url).searchParams.get('schema')
  if (!schema || schema === 'app' || !schema.includes('test')) {
    throw new Error('TEST_DATABASE_URL must name a separate test schema, for example ?schema=app_test')
  }
  return url
}

export function testConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDatabaseUrl(),
    DATABASE_SSL_CA_FILE: process.env.DATABASE_SSL_CA_FILE ?? '',
    SUPABASE_URL: 'http://127.0.0.1:1',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    SUPABASE_JWT_SECRET: '',
    EMAIL_HASH_SECRET: 'x'.repeat(64),
    ...overrides,
  })
}
