import type { ActorKind } from '@hilcoe/shared'
import type { Session, User } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { getSupabase } from './supabase'

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn'

export interface SessionSnapshot {
  status: SessionStatus
  session: Session | null
  /** A message for the next sign-in page, such as why the session ended. */
  notice: string | null
}

let snapshot: SessionSnapshot = { status: 'loading', session: null, notice: null }
const listeners = new Set<() => void>()
const signedOutListeners = new Set<() => void>()
let started = false

function update(next: Partial<SessionSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Follows Supabase's stored session. INITIAL_SESSION arrives first, so status leaves 'loading'. */
export function startSession(): void {
  if (started) return
  started = true
  getSupabase().auth.onAuthStateChange((_event, session) => {
    update({ status: session ? 'signedIn' : 'signedOut', session })
  })
}

export function useSession(): SessionSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot
}

/** Supplies the access token to client.api; Supabase refreshes it first when it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession()
  return data.session?.access_token ?? null
}

/** Runs after every sign-out, for example to clear cached server data. */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener)
  return () => signedOutListeners.delete(listener)
}

let signingOut: Promise<void> | null = null

/** Ends the current session only (Sign In and Sign Out); other devices stay signed in. */
export function signOut(notice: string | null = null): Promise<void> {
  update({ notice })
  signingOut ??= getSupabase()
    .auth.signOut({ scope: 'local' })
    .then(() => undefined)
    .finally(() => {
      signingOut = null
      for (const listener of signedOutListeners) listener()
    })
  return signingOut
}

export function clearNotice(): void {
  if (snapshot.notice !== null) update({ notice: null })
}

/** The account type recorded at creation in app_metadata. A hint for the sign-in pages only. */
export function accountKindOf(user: User | null | undefined): ActorKind | null {
  const kind: unknown = user?.app_metadata?.account_kind
  return kind === 'MEMBER' || kind === 'ADMIN' ? kind : null
}

export interface Assurance {
  current: 'aal1' | 'aal2' | null
  hasVerifiedFactor: boolean
}

export function assuranceOf(session: Session | null): Assurance {
  if (!session) return { current: null, hasVerifiedFactor: false }
  const aal = decodeClaims(session.access_token).aal
  return {
    current: aal === 'aal1' || aal === 'aal2' ? aal : null,
    hasVerifiedFactor: (session.user.factors ?? []).some(
      (factor) => factor.factor_type === 'totp' && factor.status === 'verified',
    ),
  }
}

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1] ?? ''
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
