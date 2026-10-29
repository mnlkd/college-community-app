import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_IDLE_LIMIT_MS, ADMIN_SESSION_LIMIT_MS } from '../../src/infrastructure/auth-middleware.js'
import { resetDatabase } from '../helpers/database.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp
const MINUTE = 60_000

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(() => resetDatabase(t.container.prisma))

async function createMember(overrides: { state?: 'ACTIVE' | 'DISABLED' } = {}) {
  const authUserId = randomUUID()
  const member = await t.container.prisma.memberAccount.create({
    data: {
      authUserId,
      email: `${authUserId}@hilcoeschool.com`,
      displayName: 'Test Student',
      role: 'STUDENT',
      state: overrides.state ?? 'ACTIVE',
    },
  })
  return { authUserId, member }
}

async function createAdmin(overrides: { state?: 'ACTIVE' | 'DISABLED'; isFirstAdmin?: boolean } = {}) {
  const authUserId = randomUUID()
  const admin = await t.container.prisma.administratorAccount.create({
    data: {
      authUserId,
      email: `${authUserId}@hilcoeschool.com`,
      state: overrides.state ?? 'ACTIVE',
      isFirstAdmin: overrides.isFirstAdmin ?? false,
    },
  })
  return { authUserId, admin }
}

const nowSeconds = () => Math.floor(t.clock.now().getTime() / 1000)

function getMe(path: string, token?: string) {
  const call = request(t.app).get(path)
  return token ? call.set('Authorization', `Bearer ${token}`) : call
}

describe('AuthMiddleware.authenticate', () => {
  it.each(['/api/accounts/me', '/api/admin/accounts/me'])('refuses %s without a token', async (path) => {
    const response = await getMe(path)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('refuses malformed, foreign-key and expired tokens with 401', async () => {
    const { authUserId } = await createMember()
    const tokens = [
      'garbage',
      await t.jwks.signWithForeignKey({ sub: authUserId }),
      await t.jwks.sign({ sub: authUserId, expiresIn: '-1m' }),
    ]
    for (const token of tokens) {
      const response = await getMe('/api/accounts/me', token)
      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('UNAUTHENTICATED')
    }
    const basic = await request(t.app).get('/api/accounts/me').set('Authorization', 'Basic abc')
    expect(basic.status).toBe(401)
  })

  it('refuses a valid token that has no platform account with 401', async () => {
    const response = await getMe('/api/accounts/me', await t.jwks.sign({ sub: randomUUID() }))
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHENTICATED')
  })

  it('returns the member ActorContext', async () => {
    const { authUserId, member } = await createMember()
    const response = await getMe('/api/accounts/me', await t.jwks.sign({ sub: authUserId }))
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      accountId: member.id,
      kind: 'MEMBER',
      role: 'STUDENT',
      alumniStatus: null,
      accountState: 'ACTIVE',
      restrictedUntil: null,
      mfaVerified: false,
      isFirstAdmin: false,
    })
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('fills restrictedUntil from the latest current restriction only', async () => {
    const { authUserId, member } = await createMember()
    const prisma = t.container.prisma
    const now = t.clock.now()
    const until = new Date(now.getTime() + 14 * 24 * 60 * MINUTE)
    for (const restrictUntil of [new Date(now.getTime() - MINUTE), until]) {
      const violation = await prisma.violation.create({
        data: { memberId: member.id, targetType: 'POST', targetId: randomUUID(), decisionAt: now },
      })
      await prisma.consequence.create({
        data: { memberId: member.id, violationId: violation.id, kind: 'RESTRICTION', restrictUntil },
      })
    }
    const response = await getMe('/api/accounts/me', await t.jwks.sign({ sub: authUserId }))
    expect(response.body.restrictedUntil).toBe(until.toISOString())
  })

  it('refuses a disabled member with 403', async () => {
    const { authUserId } = await createMember({ state: 'DISABLED' })
    const response = await getMe('/api/accounts/me', await t.jwks.sign({ sub: authUserId }))
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('refuses a member token on an Administrator endpoint with 403', async () => {
    const { authUserId } = await createMember()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId: randomUUID() })
    const response = await getMe('/api/admin/accounts/me', token)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('refuses an Administrator token on a member endpoint with 403', async () => {
    const { authUserId } = await createAdmin()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId: randomUUID() })
    const response = await getMe('/api/accounts/me', token)
    expect(response.status).toBe(403)
  })

  it('refuses a disabled Administrator with 403', async () => {
    const { authUserId } = await createAdmin({ state: 'DISABLED' })
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId: randomUUID() })
    expect((await getMe('/api/admin/accounts/me', token)).status).toBe(403)
  })
})

describe('AuthMiddleware.requireAdministrator', () => {
  it('refuses an Administrator without AAL2', async () => {
    const { authUserId } = await createAdmin()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal1', sessionId: randomUUID() })
    const response = await getMe('/api/admin/accounts/me', token)
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(await t.container.prisma.adminSession.count()).toBe(0)
  })

  it('returns the Administrator ActorContext and records the session', async () => {
    const { authUserId, admin } = await createAdmin({ isFirstAdmin: true })
    const sessionId = randomUUID()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId })
    const response = await getMe('/api/admin/accounts/me', token)
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      accountId: admin.id,
      kind: 'ADMIN',
      mfaVerified: true,
      isFirstAdmin: true,
    })
    const session = await t.container.prisma.adminSession.findUniqueOrThrow({
      where: { supabaseSessionId: sessionId },
    })
    expect(session.adminId).toBe(admin.id)
    expect(session.expiresAt.getTime() - session.firstSeenAt.getTime()).toBe(ADMIN_SESSION_LIMIT_MS)
  })

  it('ends the session after 30 minutes idle, and it stays ended', async () => {
    const { authUserId } = await createAdmin()
    const sessionId = randomUUID()
    const token = async () => t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId })

    expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(200)
    t.clock.advance(ADMIN_IDLE_LIMIT_MS - MINUTE)
    expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(200)
    t.clock.advance(ADMIN_IDLE_LIMIT_MS - MINUTE)
    expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(200)

    t.clock.advance(ADMIN_IDLE_LIMIT_MS + 1000)
    const ended = await getMe('/api/admin/accounts/me', await token())
    expect(ended.status).toBe(401)
    expect(ended.body.error.code).toBe('UNAUTHENTICATED')
    t.clock.advance(1000)
    expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(401)
  })

  it('ends the session 8 hours after it started, even while active', async () => {
    const { authUserId } = await createAdmin()
    const sessionId = randomUUID()
    const token = async () => t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId })

    for (let elapsed = 0; elapsed < ADMIN_SESSION_LIMIT_MS; elapsed += 25 * MINUTE) {
      expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(200)
      t.clock.advance(25 * MINUTE)
    }
    t.clock.set(new Date((await firstSeen(sessionId)).getTime() + ADMIN_SESSION_LIMIT_MS))
    expect((await getMe('/api/admin/accounts/me', await token())).status).toBe(401)
  })

  it('counts the 8 hours from sign-in, not from the first request', async () => {
    const { authUserId } = await createAdmin()
    const signedInAt = nowSeconds() - ADMIN_SESSION_LIMIT_MS / 1000 - 60
    const token = await t.jwks.sign({
      sub: authUserId,
      aal: 'aal2',
      sessionId: randomUUID(),
      authenticatedAt: signedInAt,
    })
    expect((await getMe('/api/admin/accounts/me', token)).status).toBe(401)
  })

  it('keeps one session row when the first requests arrive together', async () => {
    const { authUserId } = await createAdmin()
    const sessionId = randomUUID()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2', sessionId })
    const responses = await Promise.all([1, 2, 3].map(() => getMe('/api/admin/accounts/me', token)))
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(await t.container.prisma.adminSession.count({ where: { supabaseSessionId: sessionId } })).toBe(1)
  })

  it('refuses an AAL2 token without a session id', async () => {
    const { authUserId } = await createAdmin()
    const token = await t.jwks.sign({ sub: authUserId, aal: 'aal2' })
    expect((await getMe('/api/admin/accounts/me', token)).status).toBe(401)
  })
})

async function firstSeen(sessionId: string): Promise<Date> {
  const session = await t.container.prisma.adminSession.findUniqueOrThrow({
    where: { supabaseSessionId: sessionId },
  })
  return session.firstSeenAt
}
