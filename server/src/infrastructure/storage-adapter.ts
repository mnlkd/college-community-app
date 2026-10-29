import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DependencyError } from '../kernel/index.js'

export const STORAGE_BUCKETS = ['post-images', 'profile-images'] as const
export type StorageBucket = (typeof STORAGE_BUCKETS)[number]

export const SIGNED_URL_SECONDS = 60

/** Builds a storage key of the form "bucket/path". */
export function storageKey(bucket: StorageBucket, path: string): string {
  return `${bucket}/${path}`
}

function splitKey(key: string): { bucket: StorageBucket; path: string } {
  const slash = key.indexOf('/')
  const bucket = key.slice(0, slash)
  const path = key.slice(slash + 1)
  if (slash <= 0 || path === '' || !(STORAGE_BUCKETS as readonly string[]).includes(bucket)) {
    throw new Error('Invalid storage key')
  }
  return { bucket: bucket as StorageBucket, path }
}

/** Wraps the private Supabase Storage buckets (ODD Table 5). */
export class StorageAdapter {
  private readonly client: SupabaseClient

  constructor(options: { supabaseUrl: string; serviceRoleKey: string }) {
    this.client = createClient(options.supabaseUrl, options.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  }

  async upload(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { bucket, path } = splitKey(key)
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, bytes, { contentType, upsert: false })
    if (error) throw this.dependency(error)
  }

  /** A link valid for 60 seconds. */
  async createSignedUrl(key: string): Promise<string> {
    const { bucket, path } = splitKey(key)
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS)
    if (error) throw this.dependency(error)
    return data.signedUrl
  }

  /** One request per bucket; a key Storage cannot sign is left out of the map. */
  async createSignedUrls(keys: readonly string[]): Promise<Map<string, string>> {
    const byBucket = new Map<StorageBucket, string[]>()
    for (const key of new Set(keys)) {
      const { bucket, path } = splitKey(key)
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path])
    }
    const urls = new Map<string, string>()
    for (const [bucket, paths] of byBucket) {
      const { data, error } = await this.client.storage
        .from(bucket)
        .createSignedUrls(paths, SIGNED_URL_SECONDS)
      if (error) throw this.dependency(error)
      for (const entry of data) {
        if (entry.path && entry.signedUrl && !entry.error)
          urls.set(storageKey(bucket, entry.path), entry.signedUrl)
      }
    }
    return urls
  }

  async remove(key: string): Promise<void> {
    const { bucket, path } = splitKey(key)
    const { error } = await this.client.storage.from(bucket).remove([path])
    if (error) throw this.dependency(error)
  }

  private dependency(cause: unknown): DependencyError {
    return new DependencyError('File storage is unavailable. Try again shortly.', { cause })
  }
}
