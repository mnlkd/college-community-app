import { readFileSync } from 'node:fs'
import { PrismaPg } from '@prisma/adapter-pg'
import type { ConnectionOptions } from 'node:tls'
import { PrismaClient } from '../generated/prisma/client.js'

/** Name of the private PostgreSQL schema holding the application tables. */
export const APP_SCHEMA = 'app'

export interface DatabaseOptions {
  databaseUrl: string
  /** PEM file of the Supabase CA; when given, the server certificate is verified. */
  sslCaFile?: string | null
}

/**
 * Connection settings shared by Prisma and raw SQL. The schema comes from the URL's
 * `schema` parameter and is also set as search_path, so raw SQL reaches the same tables.
 */
export function connectionConfig(options: DatabaseOptions): {
  connectionString: string
  schema: string
  options: string
  ssl: false | ConnectionOptions
} {
  const url = new URL(options.databaseUrl)
  const schema = url.searchParams.get('schema') ?? APP_SCHEMA
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid database schema name')
  url.searchParams.delete('schema')
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  const ssl: false | ConnectionOptions = options.sslCaFile
    ? { ca: readFileSync(options.sslCaFile, 'utf8'), rejectUnauthorized: true }
    : local
      ? false
      : { rejectUnauthorized: false }
  return { connectionString: url.toString(), schema, options: `-c search_path=${schema}`, ssl }
}

export function createPrismaClient(options: DatabaseOptions): PrismaClient {
  const { schema, ...pool } = connectionConfig(options)
  const adapter = new PrismaPg({ ...pool, max: 10, idleTimeoutMillis: 30_000 }, { schema })
  return new PrismaClient({ adapter })
}

export type { PrismaClient }
