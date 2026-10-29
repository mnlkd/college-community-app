import type { ActorKind } from '@hilcoe/shared'

export interface AuthUser {
  id: string
  /** Lower case. */
  email: string
  emailConfirmed: boolean
}

/**
 * The Supabase Auth operations identity needs (implemented by SupabaseAuthAdapter). The
 * client calls Supabase directly for codes, passwords and email changes (SDD Section 2.4).
 */
export interface AuthProvider {
  getUser(authUserId: string): Promise<AuthUser>
  /** Checks a password without keeping the session it opens. */
  verifyPassword(email: string, password: string): Promise<boolean>
  /** Records the account kind in app_metadata, a hint for the sign-in pages. */
  setAccountKind(authUserId: string, kind: ActorKind): Promise<void>
  /** Emails an invitation code and returns the new auth user's id. */
  inviteUser(email: string, kind: ActorKind): Promise<string>
  /** Replaces the sign-in email without a confirmation step (Update Member Email). */
  updateEmail(authUserId: string, email: string): Promise<void>
  /** Blocks sign-in and token refresh until unbanned. */
  banUser(authUserId: string): Promise<void>
  unbanUser(authUserId: string): Promise<void>
  /** Ends every session of the user. */
  signOutAll(authUserId: string): Promise<void>
  /** Removes every second factor, so the user enrolls again at the next sign-in. */
  removeMfaFactors(authUserId: string): Promise<void>
  deleteUser(authUserId: string): Promise<void>
}
