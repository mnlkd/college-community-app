import type { RegistrationKind } from '@hilcoe/shared'
import { isAuthError, type AuthError } from '@supabase/supabase-js'
import { authErrorMessage } from './messages'
import { getPasswordCheckClient, getSupabase } from './supabase'

/** A Supabase Auth step failed; `field` names the form field the message belongs to, if any. */
export class AuthFlowError extends Error {
  constructor(
    message: string,
    readonly field: string | null = null,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'AuthFlowError'
  }
}

function fail(error: AuthError | Error, fallback: string, field: string | null = null): never {
  const code = isAuthError(error) ? (error.code ?? null) : null
  throw new AuthFlowError(authErrorMessage(error, fallback), field, code)
}

/** Kept in user_metadata so the profile step still knows the chosen path after a reload. */
export interface SignUpMetadata {
  display_name: string
  registration_kind: RegistrationKind
}

export function signUpMetadataOf(metadata: Record<string, unknown> | undefined): Partial<SignUpMetadata> {
  const kind = metadata?.registration_kind
  const name = metadata?.display_name
  return {
    registration_kind: kind === 'STUDENT_OR_STAFF' || kind === 'ALUMNI' ? kind : undefined,
    display_name: typeof name === 'string' ? name : undefined,
  }
}

/**
 * Register Account, first step: Supabase Auth stores the credentials and emails a 6-digit code.
 * Returns 'exists' when the email already has a confirmed account (Supabase sends no code then).
 */
export async function signUpMember(input: {
  email: string
  password: string
  metadata: SignUpMetadata
}): Promise<'codeSent' | 'exists'> {
  const { data, error } = await getSupabase().auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { ...input.metadata } },
  })
  if (error) fail(error, 'Registration failed. Try again.')
  return data.user && data.user.identities?.length === 0 ? 'exists' : 'codeSent'
}

export async function resendSignUpCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({ type: 'signup', email })
  if (error) fail(error, 'The code could not be sent. Try again.')
}

/** Accepting the code signs the new user in; the platform account is created next. */
export async function verifySignUpCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'signup' })
  if (error) fail(error, 'The code could not be checked. Try again.', 'code')
}

/** Picks up app_metadata changed by the server, such as the account-kind hint. */
export async function refreshSession(): Promise<void> {
  await getSupabase().auth.refreshSession()
}

// Recover Forgotten Password

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email)
  if (error) fail(error, 'The reset code could not be sent. Try again.')
}

/** A valid recovery code gives a session that may only set a new password. */
export async function verifyRecoveryCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'recovery' })
  if (error) fail(error, 'The code could not be checked. Try again.', 'code')
}

/** Sets the new password, then signs out every session, including this one. */
export async function completePasswordReset(password: string): Promise<void> {
  const auth = getSupabase().auth
  const { error } = await auth.updateUser({ password })
  if (error) fail(error, 'The password could not be changed. Try again.', 'password')
  await auth.signOut({ scope: 'global' })
}

// Change Password and Change Account Email (re-authenticate with the current password first)

/**
 * Checks the current password. Members sign in again, which gives the fresh session Supabase may
 * need for the change. Administrators check it on a separate client so the AAL2 session stays.
 */
async function reauthenticate(email: string, currentPassword: string, keepSession: boolean): Promise<void> {
  const auth = keepSession ? getPasswordCheckClient().auth : getSupabase().auth
  const { error } = await auth.signInWithPassword({ email, password: currentPassword })
  if (!error) {
    if (keepSession) await auth.signOut({ scope: 'local' })
    return
  }
  if (error.code === 'invalid_credentials') {
    throw new AuthFlowError('The current password is incorrect.', 'currentPassword', error.code)
  }
  fail(error, 'Your password could not be checked. Try again.')
}

/** Keeps this device signed in and signs out every other session. */
export async function changePassword(input: {
  email: string
  currentPassword: string
  newPassword: string
  /** Administrators: keep the AAL2 session. */
  keepSession?: boolean
}): Promise<void> {
  await reauthenticate(input.email, input.currentPassword, input.keepSession ?? false)
  const auth = getSupabase().auth
  const { error } = await auth.updateUser({ password: input.newPassword })
  if (error) fail(error, 'The password could not be changed. Try again.', 'newPassword')
  await auth.signOut({ scope: 'others' })
}

/** Sends a 6-digit code to the new address; the account email changes only after the code. */
export async function requestEmailChange(input: {
  email: string
  currentPassword: string
  newEmail: string
  /** Administrators: keep the AAL2 session. */
  keepSession?: boolean
}): Promise<void> {
  await reauthenticate(input.email, input.currentPassword, input.keepSession ?? false)
  const { error } = await getSupabase().auth.updateUser({ email: input.newEmail })
  if (error) fail(error, 'The code could not be sent. Try again.', 'newEmail')
}

export async function verifyEmailChangeCode(newEmail: string, code: string): Promise<void> {
  const { data, error } = await getSupabase().auth.verifyOtp({
    email: newEmail,
    token: code,
    type: 'email_change',
  })
  if (error) fail(error, 'The code could not be checked. Try again.', 'code')
  // With "secure email change" on, Supabase accepts the code but waits for a second code sent to
  // the old address. The SRS sends a code only to the new address, so treat that as a failure.
  if (data.user?.email?.toLowerCase() !== newEmail.toLowerCase()) {
    throw new AuthFlowError(
      'The email could not be changed. Ask an Administrator to check the email settings.',
      null,
      'email_change_incomplete',
    )
  }
}

export async function resendEmailChangeCode(newEmail: string): Promise<void> {
  const { error } = await getSupabase().auth.resend({ type: 'email_change', email: newEmail })
  if (error) fail(error, 'The code could not be sent. Try again.')
}

// Accept an Administrator invitation (Create Administrator, Batch 1b)

/** The 6-digit code from the invitation email signs the invited Administrator in at AAL1. */
export async function verifyInviteCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({ email, token: code, type: 'invite' })
  if (error) fail(error, 'The code could not be checked. Try again.', 'code')
}

/** Sets the first password; the authenticator is enrolled next on the sign-in page. */
export async function setInvitedPassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password })
  if (error) fail(error, 'The password could not be set. Try again.', 'password')
}
