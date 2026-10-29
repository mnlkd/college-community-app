import { isAuthApiError, isAuthError, type AuthError } from '@supabase/supabase-js'

/** User-facing text for Supabase Auth errors. Never echoes the raw server text. */
export function authErrorMessage(error: AuthError | Error, fallback = 'Sign-in failed. Try again.'): string {
  if (isAuthError(error)) {
    if (error.status === 429) return 'Too many attempts. Wait a few minutes and try again.'
    switch (error.code) {
      case 'invalid_credentials':
        return 'The email or password is incorrect.'
      case 'email_not_confirmed':
        return 'Confirm your email address with the code we sent before signing in.'
      case 'user_banned':
        return 'This account cannot sign in. Contact an Administrator.'
      case 'mfa_verification_failed':
      case 'mfa_challenge_expired':
        return 'That code is not correct. Enter the current 6-digit code from your authenticator app.'
      case 'otp_expired':
        return 'That code is not correct or has expired. Enter the latest code we emailed, or send a new one.'
      case 'same_password':
        return 'Choose a password different from your current one.'
      case 'weak_password':
        return 'Use a password of 15 to 72 characters.'
      case 'email_exists':
      case 'user_already_exists':
        return 'That email is already used by another account.'
      case 'email_address_invalid':
        return 'Enter a valid email address.'
      case 'signup_disabled':
        return 'Registration is closed at the moment.'
      default:
        break
    }
    if (!isAuthApiError(error) || error.status >= 500) {
      return 'The sign-in service could not be reached. Try again.'
    }
  }
  return fallback
}
