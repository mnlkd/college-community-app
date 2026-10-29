import { STORAGE_BUCKETS, storageKey, type StorageBucket } from './storage-adapter.js'

/** Raw SQL access to the Supabase schemas (the Prisma client connects as the database owner). */
interface SqlClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>
}

/** One page of an inventory listing; pass `next` back to read the following page. */
export interface InventoryPage {
  items: string[]
  next: string | null
}

/**
 * Lists what Supabase holds outside the platform tables, for the CleanupJob sweeps that retry
 * failed file and user deletions. Reads only; deletion goes through the Storage and Auth APIs.
 */
export interface SupabaseInventory {
  /** Storage keys ("bucket/path") of objects created before the cutoff. */
  listStoredObjects(createdBefore: Date, after: string | null, limit: number): Promise<InventoryPage>
  /** Auth users created before the cutoff that the platform marked with an account kind. */
  listPlatformAuthUsers(createdBefore: Date, after: string | null, limit: number): Promise<InventoryPage>
}

const FIRST_ID = '00000000-0000-0000-0000-000000000000'

export class SqlSupabaseInventory implements SupabaseInventory {
  constructor(private readonly sql: SqlClient) {}

  async listStoredObjects(createdBefore: Date, after: string | null, limit: number): Promise<InventoryPage> {
    const rows = await this.sql.$queryRaw<{ id: string; bucket_id: string; name: string }[]>`
      SELECT id::text AS id, bucket_id, name FROM storage.objects
      WHERE bucket_id = ANY(${[...STORAGE_BUCKETS]}::text[]) AND created_at < ${createdBefore}::timestamptz
        AND id > ${after ?? FIRST_ID}::uuid
      ORDER BY id
      LIMIT ${limit}`
    return {
      items: rows.map((row) => storageKey(row.bucket_id as StorageBucket, row.name)),
      next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    }
  }

  async listPlatformAuthUsers(
    createdBefore: Date,
    after: string | null,
    limit: number,
  ): Promise<InventoryPage> {
    const rows = await this.sql.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM auth.users
      WHERE raw_app_meta_data ? 'account_kind' AND created_at < ${createdBefore}::timestamptz
        AND id > ${after ?? FIRST_ID}::uuid
      ORDER BY id
      LIMIT ${limit}`
    return {
      items: rows.map((row) => row.id),
      next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    }
  }
}
