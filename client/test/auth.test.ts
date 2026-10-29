import type { Session } from '@supabase/supabase-js'
import { AuthApiError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { returnPath } from '../src/auth/MemberSignIn'
import { authErrorMessage } from '../src/auth/messages'
import { accountKindOf, assuranceOf } from '../src/auth/session'
import { roleLabel } from '../src/app/identity'

function token(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${encode({ alg: 'ES256' })}.${encode(claims)}.signature`
}

function session(aal: string, factors: { factor_type: string; status: string }[] = []): Session {
  return { access_token: token({ aal, sub: 'u' }), user: { id: 'u', factors } } as unknown as Session
}

describe('assuranceOf', () => {
  it('reads the aal claim and whether a verified TOTP factor exists', () => {
    expect(assuranceOf(null)).toEqual({ current: null, hasVerifiedFactor: false })
    expect(assuranceOf(session('aal1'))).toEqual({ current: 'aal1', hasVerifiedFactor: false })
    expect(
      assuranceOf(session('aal1', [{ factor_type: 'totp', status: 'unverified' }])).hasVerifiedFactor,
    ).toBe(false)
    expect(assuranceOf(session('aal2', [{ factor_type: 'totp', status: 'verified' }]))).toEqual({
      current: 'aal2',
      hasVerifiedFactor: true,
    })
  })

  it('treats an unreadable token as no assurance', () => {
    const broken = { access_token: 'not-a-jwt', user: { id: 'u' } } as unknown as Session
    expect(assuranceOf(broken).current).toBeNull()
  })
})

describe('accountKindOf', () => {
  it('accepts only the known kinds from app_metadata', () => {
    const user = (meta: unknown) => ({ app_metadata: meta }) as never
    expect(accountKindOf(user({ account_kind: 'ADMIN' }))).toBe('ADMIN')
    expect(accountKindOf(user({ account_kind: 'MEMBER' }))).toBe('MEMBER')
    expect(accountKindOf(user({ account_kind: 'root' }))).toBeNull()
    expect(accountKindOf(user({}))).toBeNull()
    expect(accountKindOf(null)).toBeNull()
  })
})

describe('returnPath', () => {
  it('returns to a page of the same shell only', () => {
    expect(returnPath({ from: '/home?tab=1' }, 'member')).toBe('/home?tab=1')
    expect(returnPath({ from: '/admin' }, 'member')).toBe('/home')
    expect(returnPath({ from: '/admin/users' }, 'admin')).toBe('/admin/users')
    expect(returnPath({ from: '/home' }, 'admin')).toBe('/admin')
    expect(returnPath({ from: '//evil.example' }, 'member')).toBe('/home')
    expect(returnPath(null, 'admin')).toBe('/admin')
  })
})

describe('authErrorMessage', () => {
  it('maps Supabase errors to fixed messages', () => {
    expect(authErrorMessage(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe(
      'The email or password is incorrect.',
    )
    expect(authErrorMessage(new AuthApiError('slow down', 429, 'over_request_rate_limit'))).toMatch(
      /Too many attempts/,
    )
    expect(
      authErrorMessage(new AuthApiError('Invalid TOTP code entered', 422, 'mfa_verification_failed')),
    ).toMatch(/code is not correct/)
    expect(authErrorMessage(new AuthApiError('db down', 500, 'unexpected_failure'))).toMatch(
      /could not be reached/,
    )
    expect(authErrorMessage(new Error('secret detail'))).toBe('Sign-in failed. Try again.')
  })
})

describe('roleLabel', () => {
  const base = {
    accountId: '00000000-0000-4000-8000-000000000000',
    accountState: 'ACTIVE',
    restrictedUntil: null,
    mfaVerified: false,
    isFirstAdmin: false,
  } as const
  it('names the role and alumni status', () => {
    expect(roleLabel({ ...base, kind: 'MEMBER', role: 'STUDENT', alumniStatus: null })).toBe('Student')
    expect(roleLabel({ ...base, kind: 'MEMBER', role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })).toBe(
      'Alumni · Self-Reported',
    )
    expect(roleLabel({ ...base, kind: 'ADMIN', role: null, alumniStatus: null })).toBe('Administrator')
  })
})
