import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** The browser Supabase client. Created on first use so tests can run without the env. */
export function getSupabase(): SupabaseClient {
  if (client) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see client/.env.example).')
  }
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  return client
}

let checker: SupabaseClient | null = null

/**
 * A second client that keeps nothing, for checking an Administrator's password without replacing
 * the browser session: a password sign-in would drop the session from AAL2 to AAL1.
 */
export function getPasswordCheckClient(): SupabaseClient {
  if (checker) return checker
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see client/.env.example).')
  }
  checker = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'hilcoe-password-check',
    },
  })
  return checker
}
