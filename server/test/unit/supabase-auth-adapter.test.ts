import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SupabaseAuthAdapter } from '../../src/infrastructure/supabase-auth-adapter.js'
import { AuthenticationError } from '../../src/kernel/index.js'
import { JwksServer } from '../helpers/jwks-server.js'

const sub = '01900000-0000-7000-8000-0000000000aa'
const jwks = new JwksServer()
let adapter: SupabaseAuthAdapter

const noSql = { $executeRaw: () => Promise.resolve(0), $queryRaw: <T>() => Promise.resolve([] as T) }

beforeAll(async () => {
  await jwks.start()
  adapter = new SupabaseAuthAdapter({
    sql: noSql,
    supabaseUrl: jwks.url,
    serviceRoleKey: 'k',
    jwtSecret: null,
  })
})
afterAll(() => jwks.stop())

describe('SupabaseAuthAdapter.verifyAccessToken', () => {
  it('accepts a token signed with a published key and reads its claims', async () => {
    const token = await jwks.sign({ sub, aal: 'aal2', sessionId: 'sess-1', authenticatedAt: 1_790_000_000 })
    await expect(adapter.verifyAccessToken(token)).resolves.toEqual({
      authUserId: sub,
      sessionId: 'sess-1',
      mfaVerified: true,
      authenticatedAt: new Date(1_790_000_000_000),
    })
  })

  it('treats aal1 as not MFA verified', async () => {
    const token = await jwks.sign({ sub, aal: 'aal1' })
    await expect(adapter.verifyAccessToken(token)).resolves.toMatchObject({ mfaVerified: false })
  })

  it.each([
    ['garbage', async () => 'not-a-token'],
    ['an unknown key', () => jwks.signWithForeignKey({ sub })],
    ['an expired token', () => jwks.sign({ sub, expiresIn: '-1m' })],
    ['another issuer', () => jwks.sign({ sub, issuer: 'https://evil.example/auth/v1' })],
    ['another audience', () => jwks.sign({ sub, audience: 'anon' })],
    [
      'an HS256 token when no secret is configured',
      () =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(sub)
          .setIssuer(`${jwks.url}/auth/v1`)
          .setAudience('authenticated')
          .setExpirationTime('1h')
          .sign(new TextEncoder().encode('x'.repeat(32))),
    ],
    [
      'an unsigned token',
      async () => {
        const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
        return `${part({ alg: 'none' })}.${part({ sub, aud: 'authenticated', iss: `${jwks.url}/auth/v1` })}.`
      },
    ],
  ])('rejects %s', async (_label, make) => {
    await expect(adapter.verifyAccessToken(await make())).rejects.toBeInstanceOf(AuthenticationError)
  })

  it('verifies HS256 tokens with the legacy secret when configured', async () => {
    const secret = 's'.repeat(40)
    const legacy = new SupabaseAuthAdapter({
      sql: noSql,
      supabaseUrl: jwks.url,
      serviceRoleKey: 'k',
      jwtSecret: secret,
    })
    const token = await new SignJWT({ aal: 'aal1', session_id: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(`${jwks.url}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))
    await expect(legacy.verifyAccessToken(token)).resolves.toMatchObject({ authUserId: sub, sessionId: 'x' })
  })
})
