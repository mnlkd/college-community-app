import type { ImagePurpose } from '@hilcoe/shared'

/**
 * Private file storage (implemented by StorageAdapter). Keys have the form "bucket/path".
 * Packages depend on this port because they cannot import infrastructure.
 */
export interface FileStorage {
  upload(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  /** A link valid for 60 seconds. */
  createSignedUrl(key: string): Promise<string>
  /** Links valid for 60 seconds for many files at once, keyed by storage key. */
  createSignedUrls(keys: readonly string[]): Promise<Map<string, string>>
  remove(key: string): Promise<void>
}

export interface PreparedImage {
  bytes: Uint8Array
  contentType: string
  extension: string
}

/** Image checks and re-encoding (implemented by ImageProcessor). */
export interface ImageProcessing {
  /** Raises ValidationError on the given field for an unaccepted or unreadable image. */
  process(bytes: Uint8Array, purpose: ImagePurpose, field?: string): Promise<PreparedImage>
}

/** Minimal logging port for best-effort work after a commit. Never pass user content. */
export interface WarningLogger {
  warn(details: object, message: string): void
}
