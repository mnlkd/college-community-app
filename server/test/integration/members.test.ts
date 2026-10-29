import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AccountLifecycleEvent } from '../../src/identity/index.js'
import { ConflictError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, PASSWORD, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp
const events: AccountLifecycleEvent[] = []

beforeAll(async () => {
  t = await startTestApp()
  t.container.lifecycle.register({
    beforeRoleChange: async () => {},
    onAccountEvent: async (tx, event) => {
      events.push(event)
      // Proves the handler runs inside the deletion transaction.
      const rows = await tx.$queryRaw<{ state: string }[]>`
        SELECT state::text FROM member_account WHERE id = ${event.memberId}::uuid`
      expect(rows[0]?.state).toBe('ACTIVE')
    },
  })
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  events.length = 0
  t.storage.files.clear()
  await resetDatabase(t.container.prisma)
})

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

async function restrict(member: TestMember) {
  const prisma = t.container.prisma
  const violation = await prisma.violation.create({
    data: { memberId: member.id, targetType: 'POST', targetId: randomUUID(), decisionAt: NOW },
  })
  await prisma.consequence.create({
    data: {
      memberId: member.id,
      violationId: violation.id,
      kind: 'RESTRICTION',
      restrictUntil: new Date(NOW.getTime() + 14 * 86_400_000),
    },
  })
}

describe('GET /api/members/:memberId/profile', () => {
  it('shows public fields only, never the email or review data', async () => {
    const owner = await createMember(t, {
      role: 'ALUMNI',
      alumniStatus: 'SELF_REPORTED',
      displayName: 'Hanan',
    })
    await t.container.prisma.alumniReview.create({
      data: {
        memberId: owner.id,
        registrationPath: 'PERSONAL_EMAIL',
        claimedFullName: 'Hanan',
        privateReason: 'x',
      },
    })
    const viewer = await createMember(t)
    const response = await api(t, viewer.token).get(`/api/members/${owner.id}/profile`)
    expect(response.status).toBe(200)
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'alumniStatus',
        'bio',
        'currentPosition',
        'displayName',
        'graduationYear',
        'memberId',
        'pictureUrl',
        'programme',
        'role',
        'studyOrExpertise',
      ].sort(),
    )
    expect(JSON.stringify(response.body)).not.toContain(owner.email)
  })

  it('is open to Administrators', async () => {
    const owner = await createMember(t)
    const admin = await createAdmin(t)
    const response = await api(t, admin.token).get(`/api/members/${owner.id}/profile`)
    expect(response.status).toBe(200)
  })

  it('refuses a restricted viewer, except for their own profile', async () => {
    const owner = await createMember(t)
    const viewer = await createMember(t)
    await restrict(viewer)
    const other = await api(t, viewer.token).get(`/api/members/${owner.id}/profile`)
    expect(other.status).toBe(403)
    const own = await api(t, viewer.token).get(`/api/members/${viewer.id}/profile`)
    expect(own.status).toBe(200)
  })

  it('shows a disabled owner, but a deleted or unknown account has no profile', async () => {
    const viewer = await createMember(t)
    const disabled = await createMember(t, { state: 'DISABLED' })
    expect((await api(t, viewer.token).get(`/api/members/${disabled.id}/profile`)).status).toBe(200)

    const gone = await createMember(t)
    await api(t, gone.token).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect((await api(t, viewer.token).get(`/api/members/${gone.id}/profile`)).status).toBe(404)
    expect((await api(t, viewer.token).get(`/api/members/${randomUUID()}/profile`)).status).toBe(404)
    expect((await api(t, viewer.token).get('/api/members/not-a-uuid/profile')).status).toBe(404)
  })
})

describe('PATCH /api/members/me/profile', () => {
  it('updates permitted fields, also during a restriction, but never the role or status', async () => {
    const member = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    await restrict(member)
    const response = await api(t, member.token).patch('/api/members/me/profile', {
      displayName: ' New Name ',
      bio: ' ',
      programme: 'SOFTWARE_ENGINEERING',
      graduationYear: 2018,
      currentPosition: 'Engineer',
      role: 'STAFF',
      alumniStatus: 'VERIFIED',
    })
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      displayName: 'New Name',
      bio: null,
      programme: 'SOFTWARE_ENGINEERING',
      graduationYear: 2018,
      currentPosition: 'Engineer',
      role: 'ALUMNI',
      alumniStatus: 'SELF_REPORTED',
    })
  })

  it('accepts a 500-character bio and refuses 501 characters', async () => {
    const member = await createMember(t)
    const base = { displayName: 'A', programme: 'COMPUTER_SCIENCE', graduationYear: 2028 }
    await api(t, member.token)
      .patch('/api/members/me/profile', { ...base, bio: 'x'.repeat(500) })
      .expect(200)
    const tooLong = await api(t, member.token).patch('/api/members/me/profile', {
      ...base,
      bio: 'x'.repeat(501),
    })
    expect(tooLong.status).toBe(422)
    expect(tooLong.body.error.fields).toHaveProperty('bio')
  })

  it('applies the role rules of the account', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const response = await api(t, staff.token).patch('/api/members/me/profile', {
      displayName: 'Staff',
      studyOrExpertise: 'SE',
      currentPosition: 'Lecturer',
      programme: 'COMPUTER_SCIENCE',
    })
    expect(response.status).toBe(422)
    expect(response.body.error.fields).toHaveProperty('programme')
  })
})

describe('profile picture', () => {
  it('stores a processed picture, serves a signed link and replaces the old file', async () => {
    const member = await createMember(t)
    const client = api(t, member.token)
    const first = await client.upload(
      '/api/members/me/profile-picture',
      'picture',
      await png(2000, 1000),
      'a.png',
    )
    expect(first.status).toBe(200)
    expect(first.body.pictureUrl).toMatch(/^https:\/\/storage\.test\/profile-images\//)
    const [key] = [...t.storage.files.keys()]
    const stored = t.storage.files.get(key!)!
    const meta = await sharp(stored.bytes).metadata()
    expect(Math.max(meta.width, meta.height)).toBe(512)

    await client
      .upload('/api/members/me/profile-picture', 'picture', await png(300, 300), 'b.png')
      .expect(200)
    expect(t.storage.files.size).toBe(1)
    expect(t.storage.files.has(key!)).toBe(false)

    const removed = await client.delete('/api/members/me/profile-picture')
    expect(removed.body.pictureUrl).toBeNull()
    expect(t.storage.files.size).toBe(0)
    expect(await t.container.prisma.profileImage.count()).toBe(0)
  })

  it('refuses files that are not images, too large or missing', async () => {
    const member = await createMember(t)
    const client = api(t, member.token)
    const text = await client.upload(
      '/api/members/me/profile-picture',
      'picture',
      Buffer.from('hello'),
      'a.png',
    )
    expect(text.status).toBe(422)
    expect(text.body.error.fields).toHaveProperty('picture')
    const big = Buffer.alloc(5 * 1024 * 1024 + 1)
    const tooBig = await client.upload('/api/members/me/profile-picture', 'picture', big, 'big.png')
    expect(tooBig.status).toBe(422)
    expect(tooBig.body.error.fields.picture).toContain('5 MB')
    const none = await client.put('/api/members/me/profile-picture')
    expect(none.status).toBe(422)
    expect(t.storage.files.size).toBe(0)
  })
})

describe('PUT /api/members/me/email', () => {
  it('copies the email Supabase Auth confirmed', async () => {
    const member = await createMember(t)
    t.authProvider.users.get(member.authUserId)!.email = 'new.address@gmail.com'
    const response = await api(t, member.token).put('/api/members/me/email')
    expect(response.status).toBe(200)
    expect(response.body.email).toBe('new.address@gmail.com')
    expect(response.body.role).toBe('STUDENT')
  })

  it('refuses an email held by another account', async () => {
    const other = await createMember(t)
    const member = await createMember(t)
    t.authProvider.users.get(member.authUserId)!.email = other.email
    const response = await api(t, member.token).put('/api/members/me/email')
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DUPLICATE')
  })
})

describe('graduation requests', () => {
  const body = { programme: 'COMPUTER_SCIENCE', graduationYear: 2026 }

  it('lets a Student send one request at a time and keeps Student access', async () => {
    const student = await createMember(t)
    const client = api(t, student.token)
    const response = await client.post('/api/members/me/graduation-requests', body)
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({ ...body, decision: 'PENDING', decidedAt: null })
    const again = await client.post('/api/members/me/graduation-requests', body)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('DUPLICATE')
    const me = await client.get('/api/members/me')
    expect(me.body).toMatchObject({ role: 'STUDENT', graduationRequest: { decision: 'PENDING' } })
    expect((await client.get('/api/members/me/graduation-requests')).body).toHaveLength(1)
  })

  it('refuses non-Students and future or early years', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    expect((await api(t, staff.token).post('/api/members/me/graduation-requests', body)).status).toBe(403)
    const student = await createMember(t)
    const future = await api(t, student.token).post('/api/members/me/graduation-requests', {
      ...body,
      graduationYear: 2027,
    })
    expect(future.status).toBe(422)
    const early = await api(t, student.token).post('/api/members/me/graduation-requests', {
      ...body,
      graduationYear: 1996,
    })
    expect(early.status).toBe(422)
  })

  it('allows only one pending request under concurrent submissions', async () => {
    const student = await createMember(t)
    const client = api(t, student.token)
    const results = await Promise.all(
      [0, 1, 2].map(() => client.post('/api/members/me/graduation-requests', body)),
    )
    expect(results.map((result) => result.status).sort()).toEqual([201, 409, 409])
  })
})

describe('DELETE /api/members/me', () => {
  it('refuses a wrong current password with a field error and changes nothing', async () => {
    const member = await createMember(t)
    const response = await api(t, member.token).delete('/api/members/me', {
      currentPassword: 'wrong password',
    })
    expect(response.status).toBe(422)
    expect(response.body.error.fields).toHaveProperty('currentPassword')
    expect(t.authProvider.users.has(member.authUserId)).toBe(true)
    expect(events).toHaveLength(0)
  })

  it('removes personal data, notices and the sign-in account, keeping the row as Deleted User', async () => {
    const member = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    const other = await createMember(t)
    const client = api(t, member.token)
    await client
      .upload('/api/members/me/profile-picture', 'picture', await png(100, 100), 'a.png')
      .expect(200)
    const prisma = t.container.prisma
    await prisma.alumniReview.create({
      data: { memberId: member.id, registrationPath: 'PERSONAL_EMAIL', claimedFullName: 'Test Member' },
    })
    const admin = await createAdmin(t)
    await prisma.auditRecord.create({
      data: {
        actorAdminId: admin.id,
        targetMemberId: member.id,
        actionCode: 'ALUMNI_REVIEWED',
        reason: 'ok',
      },
    })
    await t.container.transactions.run(async (tx) => {
      const notify = t.container.notifications
      const target = { targetType: 'POST' as const, targetId: randomUUID() }
      await notify.notify(tx, {
        recipientId: member.id,
        type: 'LIKE',
        eventKey: 'a',
        actorId: other.id,
        ...target,
      })
      await notify.notify(tx, {
        recipientId: other.id,
        type: 'LIKE',
        eventKey: 'b',
        actorId: member.id,
        ...target,
      })
    })

    const response = await client.delete('/api/members/me', { currentPassword: PASSWORD })
    expect(response.status).toBe(204)

    const row = await prisma.memberAccount.findUniqueOrThrow({ where: { id: member.id } })
    expect(row).toMatchObject({ state: 'DELETED', authUserId: null, email: null, displayName: null })
    expect(await prisma.profile.count({ where: { memberId: member.id } })).toBe(0)
    expect(await prisma.profileImage.count()).toBe(0)
    expect(await prisma.alumniReview.count()).toBe(0)
    expect(await prisma.notification.count({ where: { recipientId: member.id } })).toBe(0)
    expect(t.storage.files.size).toBe(0)
    expect(t.authProvider.users.has(member.authUserId)).toBe(false)
    expect(events).toEqual([expect.objectContaining({ kind: 'ACCOUNT_DELETED', memberId: member.id })])

    const audit = await prisma.auditRecord.findFirstOrThrow()
    expect(audit.targetMemberId).toBeNull()
    expect(audit.purgeAfter?.toISOString()).toBe(new Date(NOW.getTime() + 365 * 86_400_000).toISOString())

    // The other member's notice now names Deleted User.
    const notices = await api(t, other.token).get('/api/notifications')
    expect(notices.body.items[0]).toMatchObject({ actorId: null, actorName: 'Deleted User' })

    // The old token no longer works.
    expect((await client.get('/api/members/me')).status).toBe(401)
  })

  it('rolls everything back when Supabase Auth cannot delete the user', async () => {
    const member = await createMember(t)
    t.authProvider.failNextDelete = true
    const response = await api(t, member.token).delete('/api/members/me', { currentPassword: PASSWORD })
    expect(response.status).toBe(500)
    const row = await t.container.prisma.memberAccount.findUniqueOrThrow({ where: { id: member.id } })
    expect(row.state).toBe('ACTIVE')
    expect(row.email).toBe(member.email)
  })

  it('is refused when a lifecycle handler refuses', async () => {
    const member = await createMember(t)
    const local = await startTestApp()
    try {
      local.container.lifecycle.register({
        beforeRoleChange: async () => {},
        onAccountEvent: async () => {
          throw new ConflictError('blocked')
        },
      })
      local.authProvider.addUser(member.email, { id: member.authUserId, password: PASSWORD })
      const token = await local.jwks.sign({ sub: member.authUserId })
      const response = await api(local, token).delete('/api/members/me', { currentPassword: PASSWORD })
      expect(response.status).toBe(409)
      const row = await local.container.prisma.memberAccount.findUniqueOrThrow({ where: { id: member.id } })
      expect(row.state).toBe('ACTIVE')
    } finally {
      await local.close()
    }
  })
})
