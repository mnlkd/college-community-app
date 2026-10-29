import { AuthApiError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthFlowError, changePassword, signUpMember, verifyEmailChangeCode } from '../src/auth/account-auth'

const auth = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))
const checkAuth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signOut: vi.fn() }))

vi.mock('../src/auth/supabase', () => ({
  getSupabase: () => ({ auth }),
  getPasswordCheckClient: () => ({ auth: checkAuth }),
}))

beforeEach(() => {
  for (const mock of [...Object.values(auth), ...Object.values(checkAuth)]) mock.mockReset()
})

describe('verifyEmailChangeCode', () => {
  it('succeeds when Supabase returns the user with the new email', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { email: 'New@Example.com' } }, error: null })
    await expect(verifyEmailChangeCode('new@example.com', '123456')).resolves.toBeUndefined()
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: 'new@example.com',
      token: '123456',
      type: 'email_change',
    })
  })

  it('reports a wrong code on the code field', async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
    })
    await expect(verifyEmailChangeCode('new@example.com', '123456')).rejects.toMatchObject({ field: 'code' })
  })

  it('fails when Supabase waits for a second confirmation from the old address', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: null })
    const result = verifyEmailChangeCode('new@example.com', '123456')
    await expect(result).rejects.toBeInstanceOf(AuthFlowError)
    await expect(result).rejects.toMatchObject({ code: 'email_change_incomplete' })
  })
})

describe('signUpMember', () => {
  const input = {
    email: 'new@hilcoeschool.com',
    password: 'correct horse battery staple',
    metadata: { display_name: 'New Student', registration_kind: 'STUDENT_OR_STAFF' as const },
  }

  it('reports a sent code for a new address', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { identities: [{ id: 'i' }] } }, error: null })
    await expect(signUpMember(input)).resolves.toBe('codeSent')
  })

  it('reports an existing address, which Supabase answers with no identities', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { identities: [] } }, error: null })
    await expect(signUpMember(input)).resolves.toBe('exists')
  })
})

describe('changePassword', () => {
  const input = {
    email: 'a@hilcoeschool.com',
    currentPassword: 'old password value',
    newPassword: 'new password value',
  }

  beforeEach(() => {
    for (const signIn of [auth.signInWithPassword, checkAuth.signInWithPassword]) {
      signIn.mockResolvedValue({ data: {}, error: null })
    }
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    auth.signOut.mockResolvedValue({ error: null })
    checkAuth.signOut.mockResolvedValue({ error: null })
  })

  it('signs members in again on the browser session', async () => {
    await changePassword(input)
    expect(auth.signInWithPassword).toHaveBeenCalledOnce()
    expect(checkAuth.signInWithPassword).not.toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' })
  })

  it('checks an Administrator password on the separate client and keeps the AAL2 session', async () => {
    await changePassword({ ...input, keepSession: true })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(checkAuth.signInWithPassword).toHaveBeenCalledWith({
      email: input.email,
      password: input.currentPassword,
    })
    expect(checkAuth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: input.newPassword })
  })
})
