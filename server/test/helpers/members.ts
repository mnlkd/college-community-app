import { randomUUID } from 'node:crypto'
import type { Role } from '@hilcoe/shared'
import request from 'supertest'
import type { TestApp } from './test-app.js'

export const NOW = new Date('2026-10-01T09:00:00Z')
export const PASSWORD = 'correct horse battery staple'

export interface TestMember {
  id: string
  authUserId: string
  email: string
  token: string
}

/** Creates a confirmed Supabase user (fake) and a platform account directly in the database. */
export async function createMember(
  t: TestApp,
  options: {
    role?: Role
    alumniStatus?: 'SELF_REPORTED' | 'VERIFIED' | 'FLAGGED'
    displayName?: string
    email?: string
    state?: 'ACTIVE' | 'DISABLED'
  } = {},
): Promise<TestMember> {
  const role = options.role ?? 'STUDENT'
  const email = options.email ?? `${randomUUID()}@hilcoeschool.com`
  const user = t.authProvider.addUser(email, { password: PASSWORD })
  const account = await t.container.prisma.memberAccount.create({
    data: {
      authUserId: user.id,
      email: user.email,
      displayName: options.displayName ?? 'Test Member',
      role,
      alumniStatus: role === 'ALUMNI' ? (options.alumniStatus ?? 'VERIFIED') : null,
      programme: role === 'STAFF' ? null : 'COMPUTER_SCIENCE',
      state: options.state ?? 'ACTIVE',
      profile: { create: { graduationYear: role === 'STAFF' ? null : role === 'STUDENT' ? 2028 : 2020 } },
    },
  })
  return {
    id: account.id,
    authUserId: user.id,
    email: user.email,
    token: await t.jwks.sign({ sub: user.id }),
  }
}

export interface TestAdmin {
  id: string
  authUserId: string
  email: string
  token: string
}

/** A confirmed Supabase user (fake) and an Administrator account with an AAL2 token. */
export async function createAdmin(
  t: TestApp,
  options: { isFirstAdmin?: boolean; email?: string } = {},
): Promise<TestAdmin> {
  const email = options.email ?? `admin.${randomUUID()}@hilcoeschool.com`
  const user = t.authProvider.addUser(email, { password: PASSWORD })
  user.accountKind = 'ADMIN'
  user.mfaFactors = 1
  const admin = await t.container.prisma.administratorAccount.create({
    data: { authUserId: user.id, email: user.email, isFirstAdmin: options.isFirstAdmin ?? false },
  })
  const token = await t.jwks.sign({ sub: user.id, aal: 'aal2', sessionId: randomUUID() })
  return { id: admin.id, authUserId: user.id, email: user.email, token }
}

/** Authorized request helper. */
export function api(t: TestApp, token: string) {
  const auth = (call: request.Test) => call.set('Authorization', `Bearer ${token}`)
  return {
    get: (path: string) => auth(request(t.app).get(path)),
    post: (path: string, body?: object) => auth(request(t.app).post(path)).send(body),
    patch: (path: string, body?: object) => auth(request(t.app).patch(path)).send(body),
    put: (path: string, body?: object) => auth(request(t.app).put(path)).send(body),
    delete: (path: string, body?: object) => auth(request(t.app).delete(path)).send(body),
    upload: (path: string, field: string, bytes: Buffer, filename: string) =>
      auth(request(t.app).put(path)).attach(field, bytes, filename),
  }
}
