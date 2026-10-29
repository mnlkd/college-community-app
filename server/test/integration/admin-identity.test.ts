import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashEmail, type AccountLifecycleEvent } from '../../src/identity/index.js'
import { ConflictError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, type TestAdmin } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp
let admin: TestAdmin

/** A lifecycle handler from a later batch, plugged in without changes to identity. */
const handler = {
  refuse: false,
  before: [] as AccountLifecycleEvent[],
  events: [] as AccountLifecycleEvent[],
}

beforeAll(async () => {
  t = await startTestApp()
  t.container.lifecycle.register({
    beforeRoleChange: async (_tx, event) => {
      handler.before.push(event)
      if (handler.refuse) throw new ConflictError('The member owns an open group.')
    },
    onAccountEvent: async (_tx, event) => void handler.events.push(event),
  })
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  await resetDatabase(t.container.prisma)
  handler.refuse = false
  handler.before = []
  handler.events = []
  admin = await createAdmin(t)
})

const reason = 'Corroborated with the registrar in person'
const as = (token: string) => api(t, token)
const db = () => t.container.prisma
const audits = () =>
  db().auditRecord.findMany({
    select: { actionCode: true, actorAdminId: true, targetMemberId: true, targetAdminId: true, reason: true },
    orderBy: { occurredAt: 'asc' },
  })

async function selfReportedAlumni(email = `${randomUUID()}@gmail.com`) {
  const member = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED', email })
  const review = await db().alumniReview.create({
    data: {
      memberId: member.id,
      registrationPath: 'PERSONAL_EMAIL',
      claimedFullName: 'Hanan Ahmed',
      identifyingContext: 'Batch of 2019',
    },
  })
  return { member, review }
}

async function graduatingStudent() {
  const member = await createMember(t)
  const request = await db().graduationRequest.create({
    data: { memberId: member.id, programme: 'SOFTWARE_ENGINEERING', graduationYear: 2026 },
  })
  return { member, request }
}

describe('Administrator guard', () => {
  it('refuses members, Administrators without the second factor and unknown ids', async () => {
    const member = await createMember(t)
    expect((await as(member.token).get('/api/admin/members')).status).toBe(403)
    const aal1 = await t.jwks.sign({ sub: admin.authUserId, aal: 'aal1', sessionId: randomUUID() })
    expect((await as(aal1).get('/api/admin/members')).status).toBe(403)
    expect((await as(admin.token).get('/api/admin/members/not-a-uuid')).status).toBe(404)
    expect((await as(admin.token).get(`/api/admin/members/${randomUUID()}`)).status).toBe(404)
  })

  it('refuses a new session that Supabase Auth has already ended', async () => {
    t.authProvider.signedOut.add(admin.authUserId)
    const response = await as(admin.token).get('/api/admin/members')
    expect(response.status).toBe(401)
    t.authProvider.signIn(admin.authUserId)
    expect((await as(admin.token).get('/api/admin/members')).status).toBe(200)
  })
})

describe('Users list and Manage User', () => {
  it('lists live accounts with email, filters, searches and pages', async () => {
    const student = await createMember(t, { displayName: 'Selam Girma' })
    await createMember(t, { role: 'ALUMNI', alumniStatus: 'FLAGGED', displayName: 'Flagged Person' })
    await createMember(t, { state: 'DISABLED', displayName: 'Disabled Person' })
    await db().memberAccount.create({
      data: { role: 'STUDENT', state: 'DELETED', programme: null },
    })

    const all = await as(admin.token).get('/api/admin/members')
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(3)
    const flagged = await as(admin.token).get('/api/admin/members?filter=FLAGGED')
    expect(flagged.body.items.map((item: { displayName: string }) => item.displayName)).toEqual([
      'Flagged Person',
    ])
    const disabled = await as(admin.token).get('/api/admin/members?filter=DISABLED')
    expect(disabled.body.items[0].state).toBe('DISABLED')
    const search = await as(admin.token).get('/api/admin/members?query=selam')
    expect(search.body.items).toEqual([expect.objectContaining({ id: student.id, email: student.email })])
    const page = await as(admin.token).get('/api/admin/members?page=2&pageSize=2')
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3 })
    expect(page.body.items).toHaveLength(1)
    expect((await as(admin.token).get('/api/admin/members?page=9')).body.items).toEqual([])
  })

  it('shows the pending review and graduation request of one account', async () => {
    const { member, review } = await selfReportedAlumni()
    const view = await as(admin.token).get(`/api/admin/members/${member.id}`)
    expect(view.status).toBe(200)
    expect(view.body.pendingAlumniReview).toMatchObject({ id: review.id, claimedFullName: 'Hanan Ahmed' })
    expect(view.body.pendingGraduationRequest).toBeNull()
    const graduating = await graduatingStudent()
    const second = await as(admin.token).get(`/api/admin/members/${graduating.member.id}`)
    expect(second.body.pendingGraduationRequest).toMatchObject({ id: graduating.request.id })
  })
})

describe('Review Alumni Affiliation', () => {
  it('verifies the member, keeps the reason private, audits and notifies', async () => {
    const { member, review } = await selfReportedAlumni()
    const list = await as(admin.token).get('/api/admin/alumni-reviews')
    expect(list.body.items).toEqual([expect.objectContaining({ id: review.id, email: member.email })])

    const response = await as(admin.token).post(`/api/admin/alumni-reviews/${review.id}/decision`, {
      decision: 'VERIFIED',
      reason: `  ${reason}  `,
    })
    expect(response.status).toBe(204)
    const account = await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })
    expect(account.alumniStatus).toBe('VERIFIED')
    const decided = await db().alumniReview.findUniqueOrThrow({ where: { id: review.id } })
    expect(decided).toMatchObject({
      decision: 'VERIFIED',
      privateReason: reason,
      reviewedByAdminId: admin.id,
    })
    expect(await audits()).toEqual([
      {
        actionCode: 'ALUMNI_REVIEWED',
        actorAdminId: admin.id,
        targetMemberId: member.id,
        targetAdminId: null,
        reason,
      },
    ])
    const notices = await as(member.token).get('/api/notifications')
    expect(notices.body.items).toEqual([
      expect.objectContaining({ type: 'ALUMNI_DECISION', targetType: 'ALUMNI_REVIEW', actorId: null }),
    ])
    expect(JSON.stringify(notices.body)).not.toContain(reason)
    expect((await as(admin.token).get('/api/admin/alumni-reviews')).body.items).toEqual([])
  })

  it('also notifies a Flagged decision and refuses a second decision', async () => {
    const { member, review } = await selfReportedAlumni()
    const path = `/api/admin/alumni-reviews/${review.id}/decision`
    await as(admin.token).post(path, { decision: 'FLAGGED', reason }).expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).alumniStatus).toBe(
      'FLAGGED',
    )
    expect(await db().notification.count({ where: { recipientId: member.id } })).toBe(1)
    const again = await as(admin.token).post(path, { decision: 'VERIFIED', reason })
    expect(again.status).toBe(409)
    expect(await db().auditRecord.count()).toBe(1)
  })

  it('requires a reason and changes nothing without one', async () => {
    const { member, review } = await selfReportedAlumni()
    const response = await as(admin.token).post(`/api/admin/alumni-reviews/${review.id}/decision`, {
      decision: 'VERIFIED',
      reason: '   ',
    })
    expect(response.status).toBe(422)
    expect(response.body.error.fields).toHaveProperty('reason')
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).alumniStatus).toBe(
      'SELF_REPORTED',
    )
    expect(await db().auditRecord.count()).toBe(0)
  })
})

describe('Confirm Graduation', () => {
  it('makes the Student a Verified Alumni after beforeRoleChange and publishes the change', async () => {
    const { member, request } = await graduatingStudent()
    const response = await as(admin.token).post(`/api/admin/graduation-requests/${request.id}/decision`, {
      decision: 'CONFIRMED',
      reason,
    })
    expect(response.status).toBe(204)
    const account = await db().memberAccount.findUniqueOrThrow({
      where: { id: member.id },
      include: { profile: true },
    })
    expect(account).toMatchObject({
      role: 'ALUMNI',
      alumniStatus: 'VERIFIED',
      programme: 'SOFTWARE_ENGINEERING',
    })
    expect(account.profile?.graduationYear).toBe(2026)
    expect(handler.before).toEqual([
      expect.objectContaining({ kind: 'GRADUATION_CONFIRMED', newRole: 'ALUMNI' }),
    ])
    expect(handler.events).toEqual([
      expect.objectContaining({ kind: 'GRADUATION_CONFIRMED', memberId: member.id }),
    ])
    expect(await audits()).toEqual([expect.objectContaining({ actionCode: 'GRADUATION_DECIDED', reason })])
    expect(await db().notification.findMany({ where: { recipientId: member.id } })).toEqual([
      expect.objectContaining({ type: 'GRADUATION_DECISION', targetId: request.id }),
    ])
  })

  it('rolls everything back when a handler refuses the role change', async () => {
    const { member, request } = await graduatingStudent()
    handler.refuse = true
    const response = await as(admin.token).post(`/api/admin/graduation-requests/${request.id}/decision`, {
      decision: 'CONFIRMED',
      reason,
    })
    expect(response.status).toBe(409)
    expect(response.body.error.message).toBe('The member owns an open group.')
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).role).toBe('STUDENT')
    expect((await db().graduationRequest.findUniqueOrThrow({ where: { id: request.id } })).decision).toBe(
      'PENDING',
    )
    expect(await db().auditRecord.count()).toBe(0)
    expect(await db().notification.count()).toBe(0)
  })

  it('declining leaves the account unchanged but notifies the Student', async () => {
    const { member, request } = await graduatingStudent()
    await as(admin.token)
      .post(`/api/admin/graduation-requests/${request.id}/decision`, { decision: 'DECLINED', reason })
      .expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).role).toBe('STUDENT')
    expect(handler.before).toEqual([])
    expect(await db().notification.count({ where: { recipientId: member.id } })).toBe(1)
    const again = await as(admin.token).post(`/api/admin/graduation-requests/${request.id}/decision`, {
      decision: 'CONFIRMED',
      reason,
    })
    expect(again.status).toBe(409)
  })
})

describe('Maintain Staff Email List', () => {
  it('adds, refuses duplicates in any letter case, lists and removes without changing accounts', async () => {
    const added = await as(admin.token).post('/api/admin/staff-emails', {
      email: 'Dawit.Bekele@HiLCoESchool.com',
    })
    expect(added.status).toBe(201)
    expect(added.body.email).toBe('dawit.bekele@hilcoeschool.com')
    const duplicate = await as(admin.token).post('/api/admin/staff-emails', {
      email: 'DAWIT.BEKELE@hilcoeschool.com',
    })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('DUPLICATE')
    expect((await as(admin.token).post('/api/admin/staff-emails', { email: 'x@gmail.com' })).status).toBe(422)

    const staff = await createMember(t, { role: 'STAFF', email: 'dawit.bekele@hilcoeschool.com' })
    const list = await as(admin.token).get('/api/admin/staff-emails?query=dawit')
    expect(list.body.items).toEqual([expect.objectContaining({ email: 'dawit.bekele@hilcoeschool.com' })])

    t.clock.advance(1000)
    await as(admin.token).delete('/api/admin/staff-emails/Dawit.Bekele%40hilcoeschool.com').expect(204)
    expect((await as(admin.token).get('/api/admin/staff-emails')).body.total).toBe(0)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: staff.id } })).role).toBe('STAFF')
    expect(
      (await as(admin.token).delete('/api/admin/staff-emails/dawit.bekele%40hilcoeschool.com')).status,
    ).toBe(404)
    t.clock.advance(1000)
    await as(admin.token)
      .post('/api/admin/staff-emails', { email: 'dawit.bekele@hilcoeschool.com' })
      .expect(201)
    expect((await audits()).map((row) => row.actionCode)).toEqual([
      'STAFF_EMAIL_ADDED',
      'STAFF_EMAIL_REMOVED',
      'STAFF_EMAIL_ADDED',
    ])
  })
})

describe('Correct Community Role', () => {
  it('makes a Student Staff, clearing the details Staff cannot keep', async () => {
    const member = await createMember(t)
    const response = await as(admin.token).put(`/api/admin/members/${member.id}/role`, {
      newRole: 'STAFF',
      reason,
    })
    expect(response.status).toBe(204)
    const account = await db().memberAccount.findUniqueOrThrow({
      where: { id: member.id },
      include: { profile: true },
    })
    expect(account).toMatchObject({ role: 'STAFF', alumniStatus: null, programme: null })
    expect(account.profile?.graduationYear).toBeNull()
    expect(handler.before).toEqual([expect.objectContaining({ kind: 'ROLE_CORRECTED', newRole: 'STAFF' })])
    expect(handler.events).toEqual([expect.objectContaining({ kind: 'ROLE_CORRECTED', newRole: 'STAFF' })])
    expect(await audits()).toEqual([
      expect.objectContaining({ actionCode: 'ROLE_CORRECTED', targetMemberId: member.id, reason }),
    ])
  })

  it('makes a Student a Self-Reported Alumni with a new pending review', async () => {
    const member = await createMember(t)
    await as(admin.token)
      .put(`/api/admin/members/${member.id}/role`, {
        newRole: 'ALUMNI',
        alumniStatus: 'SELF_REPORTED',
        reason,
      })
      .expect(204)
    const account = await db().memberAccount.findUniqueOrThrow({
      where: { id: member.id },
      include: { profile: true },
    })
    expect(account).toMatchObject({ role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    // The expected Student year 2028 is in the future, so an Alumni cannot keep it.
    expect(account.profile?.graduationYear).toBeNull()
    expect(await db().alumniReview.findMany({ where: { memberId: member.id } })).toEqual([
      expect.objectContaining({ decision: 'PENDING', registrationPath: 'INSTITUTIONAL_EMAIL' }),
    ])
  })

  it('changes a Flagged Alumni status without a role change and refuses other same-role changes', async () => {
    const flagged = await createMember(t, { role: 'ALUMNI', alumniStatus: 'FLAGGED' })
    await as(admin.token)
      .put(`/api/admin/members/${flagged.id}/role`, { newRole: 'ALUMNI', alumniStatus: 'VERIFIED', reason })
      .expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: flagged.id } })).alumniStatus).toBe(
      'VERIFIED',
    )
    expect(handler.before).toEqual([])
    const again = await as(admin.token).put(`/api/admin/members/${flagged.id}/role`, {
      newRole: 'ALUMNI',
      alumniStatus: 'SELF_REPORTED',
      reason,
    })
    expect(again.status).toBe(409)
    const student = await createMember(t)
    expect(
      (await as(admin.token).put(`/api/admin/members/${student.id}/role`, { newRole: 'STUDENT', reason }))
        .status,
    ).toBe(409)
  })

  it('refuses a Student or Staff role for a personal email and while a decision is pending', async () => {
    const alumni = await createMember(t, { role: 'ALUMNI', email: 'hanan@gmail.com' })
    const personal = await as(admin.token).put(`/api/admin/members/${alumni.id}/role`, {
      newRole: 'STUDENT',
      reason,
    })
    expect(personal.status).toBe(422)
    expect(personal.body.error.fields).toHaveProperty('newRole')
    const { member } = await graduatingStudent()
    const pending = await as(admin.token).put(`/api/admin/members/${member.id}/role`, {
      newRole: 'STAFF',
      reason,
    })
    expect(pending.status).toBe(409)
    expect(await db().auditRecord.count()).toBe(0)
  })

  it('rolls back when a handler refuses', async () => {
    const member = await createMember(t)
    handler.refuse = true
    const response = await as(admin.token).put(`/api/admin/members/${member.id}/role`, {
      newRole: 'STAFF',
      reason,
    })
    expect(response.status).toBe(409)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).role).toBe('STUDENT')
    expect(await db().auditRecord.count()).toBe(0)
  })
})

describe('Update Member Email', () => {
  it('replaces the email in the account and in Supabase Auth and audits it', async () => {
    const member = await createMember(t)
    await as(admin.token)
      .put(`/api/admin/members/${member.id}/email`, { newEmail: 'Selam.Personal@Gmail.com', reason })
      .expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).email).toBe(
      'selam.personal@gmail.com',
    )
    expect(t.authProvider.users.get(member.authUserId)?.email).toBe('selam.personal@gmail.com')
    expect(await audits()).toEqual([expect.objectContaining({ actionCode: 'MEMBER_EMAIL_UPDATED', reason })])
  })

  it('refuses an email used by another account in any letter case', async () => {
    const member = await createMember(t)
    const other = await createMember(t)
    const taken = await as(admin.token).put(`/api/admin/members/${member.id}/email`, {
      newEmail: other.email.toUpperCase(),
      reason,
    })
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('DUPLICATE')
    const adminEmail = await as(admin.token).put(`/api/admin/members/${member.id}/email`, {
      newEmail: admin.email,
      reason,
    })
    expect(adminEmail.status).toBe(409)
  })

  it('rolls the account back when Supabase Auth fails', async () => {
    const member = await createMember(t)
    t.authProvider.failNext = 'updateEmail'
    const response = await as(admin.token).put(`/api/admin/members/${member.id}/email`, {
      newEmail: 'new@gmail.com',
      reason,
    })
    expect(response.status).toBe(500)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).email).toBe(
      member.email,
    )
    expect(await db().auditRecord.count()).toBe(0)
  })
})

describe('Investigate Impersonation and Restore Account', () => {
  it('disables, bans and signs out the account, then restores it', async () => {
    const member = await createMember(t)
    await as(admin.token).post(`/api/admin/members/${member.id}/disable`, { reason }).expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).state).toBe('DISABLED')
    expect(t.authProvider.users.get(member.authUserId)?.banned).toBe(true)
    expect(t.authProvider.signedOut.has(member.authUserId)).toBe(true)
    expect((await as(member.token).get('/api/members/me')).status).toBe(403)
    expect((await as(admin.token).post(`/api/admin/members/${member.id}/disable`, { reason })).status).toBe(
      409,
    )

    t.clock.advance(1000)
    await as(admin.token).post(`/api/admin/members/${member.id}/restore`, { reason }).expect(204)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).state).toBe('ACTIVE')
    expect(t.authProvider.users.get(member.authUserId)?.banned).toBe(false)
    expect((await as(admin.token).post(`/api/admin/members/${member.id}/restore`, { reason })).status).toBe(
      409,
    )
    expect((await audits()).map((row) => row.actionCode)).toEqual(['ACCOUNT_DISABLED', 'ACCOUNT_RESTORED'])
  })

  it('writes no audit record when the ban fails', async () => {
    const member = await createMember(t)
    t.authProvider.failNext = 'banUser'
    expect((await as(admin.token).post(`/api/admin/members/${member.id}/disable`, { reason })).status).toBe(
      500,
    )
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: member.id } })).state).toBe('ACTIVE')
    expect(await db().auditRecord.count()).toBe(0)
  })
})

describe('Delete Confirmed Fake Account', () => {
  it('deletes the account, keeps only an email hash and blocks re-registration', async () => {
    const fake = await createMember(t, { email: 'Fake.Person@hilcoeschool.com', displayName: 'Fake Person' })
    await as(admin.token).delete(`/api/admin/members/${fake.id}`, { reason }).expect(204)
    const row = await db().memberAccount.findUniqueOrThrow({ where: { id: fake.id } })
    expect(row).toMatchObject({ state: 'DELETED', email: null, displayName: null, authUserId: null })
    expect(t.authProvider.users.has(fake.authUserId)).toBe(false)
    expect(await db().blockedEmailHash.findMany()).toEqual([
      expect.objectContaining({
        emailHmac: hashEmail('fake.person@hilcoeschool.com', t.container.config.emailHashSecret),
        blockedByAdminId: admin.id,
      }),
    ])
    // The audit record keeps the reason; the deleted account's reference is anonymized (NFR-7).
    expect(await audits()).toEqual([
      expect.objectContaining({
        actionCode: 'FAKE_ACCOUNT_DELETED',
        actorAdminId: admin.id,
        targetMemberId: null,
        reason,
      }),
    ])
    expect((await as(admin.token).delete(`/api/admin/members/${fake.id}`, { reason })).status).toBe(404)

    const again = t.authProvider.addUser('FAKE.person@hilcoeschool.com')
    const register = await as(await t.jwks.sign({ sub: again.id })).post('/api/registrations', {
      kind: 'STUDENT_OR_STAFF',
      displayName: 'Fake Person',
      programme: 'COMPUTER_SCIENCE',
      graduationYear: 2028,
    })
    expect(register.status).toBe(403)
  })
})

describe('Create Administrator', () => {
  it('invites the college email and records the new Administrator', async () => {
    const response = await as(admin.token).post('/api/admin/administrators', {
      email: 'New.Admin@hilcoeschool.com',
    })
    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      email: 'new.admin@hilcoeschool.com',
      isFirstAdmin: false,
      isSelf: false,
    })
    const created = await db().administratorAccount.findUniqueOrThrow({ where: { id: response.body.id } })
    expect(created).toMatchObject({ createdByAdminId: admin.id, totpRequired: true })
    expect(t.authProvider.users.get(created.authUserId)).toMatchObject({
      invited: true,
      accountKind: 'ADMIN',
    })
    expect(await audits()).toEqual([
      expect.objectContaining({
        actionCode: 'ADMINISTRATOR_CREATED',
        targetAdminId: created.id,
        reason: null,
      }),
    ])
    const list = await as(admin.token).get('/api/admin/administrators')
    expect(list.body).toHaveLength(2)
  })

  it('refuses personal emails and emails already in use', async () => {
    const member = await createMember(t)
    const invitedBefore = [...t.authProvider.users.values()].filter((user) => user.invited).length
    expect((await as(admin.token).post('/api/admin/administrators', { email: 'a@gmail.com' })).status).toBe(
      422,
    )
    const taken = await as(admin.token).post('/api/admin/administrators', {
      email: member.email.toUpperCase(),
    })
    expect(taken.status).toBe(409)
    expect((await as(admin.token).post('/api/admin/administrators', { email: admin.email })).status).toBe(409)
    expect([...t.authProvider.users.values()].filter((user) => user.invited)).toHaveLength(invitedBefore)
  })
})

describe('Reset Administrator MFA', () => {
  it('removes the other Administrator factors and ends their sessions', async () => {
    const other = await createAdmin(t)
    await as(other.token).get('/api/admin/administrators').expect(200)
    expect(await db().adminSession.count({ where: { adminId: other.id } })).toBe(1)

    await as(admin.token).post(`/api/admin/administrators/${other.id}/mfa-reset`, { reason }).expect(204)
    expect(t.authProvider.users.get(other.authUserId)?.mfaFactors).toBe(0)
    expect(await db().adminSession.count({ where: { adminId: other.id } })).toBe(0)
    expect((await as(other.token).get('/api/admin/administrators')).status).toBe(401)
    expect(await audits()).toEqual([
      expect.objectContaining({ actionCode: 'ADMINISTRATOR_MFA_RESET', targetAdminId: other.id, reason }),
    ])
  })

  it('refuses a reset of one own factors', async () => {
    const response = await as(admin.token).post(`/api/admin/administrators/${admin.id}/mfa-reset`, { reason })
    expect(response.status).toBe(403)
  })
})

describe('Remove Administrator', () => {
  it('lets only the first Administrator remove another while two remain', async () => {
    const first = await createAdmin(t, { isFirstAdmin: true })
    const third = await createAdmin(t)

    const notFirst = await as(admin.token).delete(`/api/admin/administrators/${third.id}`, { reason })
    expect(notFirst.status).toBe(403)
    const firstItself = await as(first.token).delete(`/api/admin/administrators/${first.id}`, { reason })
    expect(firstItself.status).toBe(403)

    await as(third.token).get('/api/admin/administrators').expect(200)
    await as(first.token).delete(`/api/admin/administrators/${third.id}`, { reason }).expect(204)
    expect(await db().administratorAccount.count()).toBe(2)
    expect(t.authProvider.users.has(third.authUserId)).toBe(false)
    expect((await as(third.token).get('/api/admin/administrators')).status).toBe(401)
    expect(await audits()).toEqual([
      expect.objectContaining({
        actionCode: 'ADMINISTRATOR_REMOVED',
        actorAdminId: first.id,
        targetAdminId: null,
        reason,
      }),
    ])

    const floor = await as(first.token).delete(`/api/admin/administrators/${admin.id}`, { reason })
    expect(floor.status).toBe(409)
    expect(await db().administratorAccount.count()).toBe(2)
  })

  it('anonymizes the removed Administrator in earlier audit records', async () => {
    const first = await createAdmin(t, { isFirstAdmin: true })
    const third = await createAdmin(t)
    const member = await createMember(t)
    await as(third.token).post(`/api/admin/members/${member.id}/disable`, { reason }).expect(204)
    await as(first.token).delete(`/api/admin/administrators/${third.id}`, { reason }).expect(204)
    const disabled = await db().auditRecord.findFirstOrThrow({ where: { actionCode: 'ACCOUNT_DISABLED' } })
    expect(disabled).toMatchObject({ actorAdminId: null, targetMemberId: member.id, reason })
    expect(disabled.purgeAfter).not.toBeNull()
  })
})

describe('Administrator own email', () => {
  it('copies a confirmed college email and refuses a personal one', async () => {
    const user = t.authProvider.users.get(admin.authUserId)
    if (!user) throw new Error('missing user')
    user.email = 'renamed.admin@hilcoeschool.com'
    const response = await as(admin.token).put('/api/admin/administrators/me/email')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ email: 'renamed.admin@hilcoeschool.com', isSelf: true })
    expect(await audits()).toEqual([
      expect.objectContaining({ actionCode: 'ADMINISTRATOR_EMAIL_CHANGED', targetAdminId: admin.id }),
    ])
    user.email = 'admin@gmail.com'
    expect((await as(admin.token).put('/api/admin/administrators/me/email')).status).toBe(422)
  })
})
