import { z } from 'zod'

const optionalSecret = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Number of proxy hops to trust for the client address (Render and Vercel). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.url(),
  /** PEM file of the Supabase database CA (Dashboard > Database > SSL). Enables certificate checks. */
  DATABASE_SSL_CA_FILE: optionalSecret,
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Legacy HS256 JWT secret. When set, HS256 access tokens are verified with it; otherwise JWKS is used. */
  SUPABASE_JWT_SECRET: optionalSecret,
  /** Key of the keyed email hash (NFR-8). */
  EMAIL_HASH_SECRET: z.string().min(32),
  /** Marks the demonstration environment, where DemoSeeder.reseed may erase all data (NFR-9). */
  DEMO_ENVIRONMENT: z
    .enum(['true', 'false', ''])
    .default('false')
    .transform((value) => value === 'true'),
})

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  logLevel: string
  trustProxy: number
  databaseUrl: string
  databaseSslCaFile: string | null
  supabaseUrl: string
  supabaseServiceRoleKey: string
  supabaseJwtSecret: string | null
  emailHashSecret: string
  demoEnvironment: boolean
}>

/** Reads and checks the environment once at start-up; fails fast on a missing setting. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const names = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Invalid server environment: ${names}`)
  }
  const value = result.data
  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    databaseUrl: value.DATABASE_URL,
    databaseSslCaFile: value.DATABASE_SSL_CA_FILE,
    supabaseUrl: value.SUPABASE_URL.replace(/\/+$/, ''),
    supabaseServiceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: value.SUPABASE_JWT_SECRET,
    emailHashSecret: value.EMAIL_HASH_SECRET,
    demoEnvironment: value.DEMO_ENVIRONMENT,
  })
}
