import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/infrastructure/config.js'

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=app',
  SUPABASE_URL: 'https://example.supabase.co/',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-value',
  EMAIL_HASH_SECRET: 'k'.repeat(32),
}

describe('loadConfig', () => {
  it('applies defaults and normalizes values', () => {
    const config = loadConfig(valid)
    expect(config.port).toBe(4000)
    expect(config.supabaseUrl).toBe('https://example.supabase.co')
    expect(config.supabaseJwtSecret).toBeNull()
    expect(config.demoEnvironment).toBe(false)
  })

  it('marks the demonstration environment only when DEMO_ENVIRONMENT is true', () => {
    expect(loadConfig({ ...valid, DEMO_ENVIRONMENT: 'true' }).demoEnvironment).toBe(true)
    expect(loadConfig({ ...valid, DEMO_ENVIRONMENT: '' }).demoEnvironment).toBe(false)
    expect(() => loadConfig({ ...valid, DEMO_ENVIRONMENT: 'yes' })).toThrow(/DEMO_ENVIRONMENT/)
  })

  it('names missing settings without echoing any value', () => {
    expect(() => loadConfig({ ...valid, SUPABASE_SERVICE_ROLE_KEY: '', EMAIL_HASH_SECRET: 'short' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY, EMAIL_HASH_SECRET/,
    )
    try {
      loadConfig({ ...valid, EMAIL_HASH_SECRET: 'short' })
    } catch (error) {
      expect(String(error)).not.toContain('short')
      expect(String(error)).not.toContain('secret-value')
    }
  })
})
