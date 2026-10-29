import { describe, expect, it } from 'vitest'
import { SIGNED_URL_SECONDS, StorageAdapter, storageKey } from '../../src/infrastructure/storage-adapter.js'

describe('StorageAdapter', () => {
  it('builds keys as bucket/path and signs links for 60 seconds', () => {
    expect(storageKey('post-images', 'a/b.jpg')).toBe('post-images/a/b.jpg')
    expect(SIGNED_URL_SECONDS).toBe(60)
  })

  it('refuses keys outside the private buckets', async () => {
    const adapter = new StorageAdapter({ supabaseUrl: 'http://127.0.0.1:1', serviceRoleKey: 'k' })
    await expect(adapter.createSignedUrl('public-bucket/x.jpg')).rejects.toThrow(/Invalid storage key/)
    await expect(adapter.createSignedUrl('post-images/')).rejects.toThrow(/Invalid storage key/)
  })
})
