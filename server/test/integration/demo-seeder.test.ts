import { randomUUID } from 'node:crypto'
import type { ActorKind } from '@hilcoe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEMO_EMAILS,
  DemoEnvironmentError,
  DemoSeeder,
  type DemoAuthAdmin,
  type DemoStorageAdmin,
} from '../../src/infrastructure/demo-seeder.js'
import { resetDatabase } from '../helpers/database.js'
import { createMember, NOW } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

vi.setConfig({ testTimeout: 300_000 })

class FakeDemoAdmin implements DemoAuthAdmin, DemoStorageAdmin {
  readonly users = new Map<string, { id: string; password: string; kind: ActorKind }>()
  readonly files = new Set<string>()
  bucketsEnsured = 0

  async listUsers() {
    return new Map([...this.users].map(([email, user]) => [email, user.id]))
  }
  async ensureUser(existingId: string | null, email: string, password: string, kind: ActorKind) {
    const id = existingId ?? randomUUID()
    this.users.set(email, { id, password, kind })
    return id
  }
  async deleteUser(authUserId: string) {
    for (const [email, user] of this.users) if (user.id === authUserId) this.users.delete(email)
  }
  async ensureBuckets() {
    this.bucketsEnsured += 1
  }
  async removeAll() {
    const count = this.files.size
    this.files.clear()
    return count
  }
}

const PASSWORD = 'demo password for tests'
const db = () => t.container.prisma
let admin: FakeDemoAdmin
const seeder = (demoEnvironment: boolean) =>
  new DemoSeeder({
    db: db(),
    clock: t.clock,
    auth: admin,
    storage: admin,
    password: PASSWORD,
    demoEnvironment,
  })

async function counts() {
  return {
    admins: await db().administratorAccount.count(),
    members: await db().memberAccount.count(),
    posts: await db().post.count(),
    comments: await db().comment.count(),
    likes: await db().like.count(),
    mentorships: await db().mentorship.count(),
    opportunities: await db().opportunity.count(),
    groups: await db().group.count(),
    memberships: await db().groupMembership.count(),
    notifications: await db().notification.count(),
    reports: await db().report.count(),
  }
}

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  admin = new FakeDemoAdmin()
  await resetDatabase(db())
})

describe('DemoSeeder', () => {
  it('seeds the ten demonstration accounts and sample content idempotently', async () => {
    const summary = await seeder(false).seed()
    expect(summary).toMatchObject({ administrators: 2, members: 8, posts: 5 })
    const first = await counts()
    expect(first).toMatchObject({ admins: 2, members: 8, posts: 5, reports: 2, opportunities: 3, groups: 2 })
    expect([...admin.users.keys()].sort()).toEqual([...DEMO_EMAILS].sort())
    expect(admin.users.get('henok.tsegaye@hilcoeschool.com')).toMatchObject({
      kind: 'ADMIN',
      password: PASSWORD,
    })
    expect(await db().administratorAccount.findFirst({ where: { isFirstAdmin: true } })).toMatchObject({
      email: 'henok.tsegaye@hilcoeschool.com',
    })

    await seeder(false).seed()
    expect(await counts()).toEqual(first)
  })

  it('refuses to reseed outside the demonstration environment', async () => {
    const member = await createMember(t)
    await expect(seeder(false).reseed()).rejects.toBeInstanceOf(DemoEnvironmentError)
    expect(await db().memberAccount.findUnique({ where: { id: member.id } })).not.toBeNull()
  })

  it('reseeds from nothing: erases other accounts, content, files and auth users', async () => {
    await seeder(true).seed()
    const pristine = await counts()
    const extra = await createMember(t, { email: 'extra@hilcoeschool.com' })
    await db().post.create({ data: { authorId: extra.id, body: 'Extra post' } })
    await db().auditRecord.create({
      data: {
        actorAdminId: (await db().administratorAccount.findFirstOrThrow()).id,
        actionCode: 'REPORT_DECIDED',
      },
    })
    admin.users.set('extra@hilcoeschool.com', { id: extra.authUserId, password: 'x', kind: 'MEMBER' })
    admin.files.add('post-images/x/y.webp')
    const henokBefore = admin.users.get('henok.tsegaye@hilcoeschool.com')?.id

    const summary = await seeder(true).reseed()
    expect(summary).toMatchObject({ filesRemoved: 1, authUsersRemoved: 1, members: 8 })
    expect(summary.tablesEmptied).toBeGreaterThan(20)
    expect(await counts()).toEqual(pristine)
    expect(await db().auditRecord.count()).toBe(0)
    expect(admin.users.has('extra@hilcoeschool.com')).toBe(false)
    expect(admin.users.get('henok.tsegaye@hilcoeschool.com')?.id).toBe(henokBefore)
  })
})
