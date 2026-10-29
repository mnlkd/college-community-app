import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DELETED_USER_NAME } from '@hilcoe/shared'
import { ActorContext, PermissionDeniedError, RestrictionError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import { createAdmin, createMember, NOW } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  await resetDatabase(t.container.prisma)
})

function adminActor(id: string) {
  return new ActorContext({
    accountId: id,
    kind: 'ADMIN',
    role: null,
    alumniStatus: null,
    accountState: 'ACTIVE',
    restrictedUntil: null,
    mfaVerified: true,
    isFirstAdmin: false,
    sessionId: null,
  })
}

function memberActor(id: string, restrictedUntil: Date | null = null) {
  return new ActorContext({
    accountId: id,
    kind: 'MEMBER',
    role: 'STUDENT',
    alumniStatus: null,
    accountState: 'ACTIVE',
    restrictedUntil,
    mfaVerified: false,
    isFirstAdmin: false,
    sessionId: null,
  })
}

describe('AuditService', () => {
  it('records an Administrator action with its reason in the caller transaction', async () => {
    const admin = await createAdmin(t)
    const member = await createMember(t)
    await t.container.transactions.run((tx) =>
      t.container.audit.record(tx, {
        actor: adminActor(admin.id),
        action: 'ACCOUNT_DISABLED',
        targetMemberId: member.id,
        reason: 'Impersonation report confirmed',
      }),
    )
    const rows = await t.container.prisma.auditRecord.findMany()
    expect(rows).toEqual([
      expect.objectContaining({
        actorAdminId: admin.id,
        targetMemberId: member.id,
        actionCode: 'ACCOUNT_DISABLED',
        reason: 'Impersonation report confirmed',
        occurredAt: NOW,
        purgeAfter: null,
      }),
    ])

    await expect(
      t.container.transactions.run(async (tx) => {
        await t.container.audit.record(tx, {
          actor: adminActor(admin.id),
          action: 'ACCOUNT_RESTORED',
          reason: 'x',
        })
        throw new Error('rolled back')
      }),
    ).rejects.toThrow()
    expect(await t.container.prisma.auditRecord.count()).toBe(1)
  })

  it('refuses member actors', async () => {
    const member = await createMember(t)
    await expect(
      t.container.transactions.run((tx) =>
        t.container.audit.record(tx, { actor: memberActor(member.id), action: 'ACCOUNT_DISABLED' }),
      ),
    ).rejects.toThrow()
  })

  it('anonymizes references to an account and keeps an earlier purge date', async () => {
    const admin = await createAdmin(t)
    const member = await createMember(t)
    const other = await createMember(t)
    const prisma = t.container.prisma
    const earlier = new Date(NOW.getTime() + 86_400_000)
    await prisma.auditRecord.createMany({
      data: [
        { actorAdminId: admin.id, targetMemberId: member.id, actionCode: 'ACCOUNT_DISABLED' },
        {
          actorAdminId: admin.id,
          targetMemberId: member.id,
          actionCode: 'ACCOUNT_RESTORED',
          purgeAfter: earlier,
        },
        { actorAdminId: admin.id, targetMemberId: other.id, actionCode: 'ACCOUNT_DISABLED' },
      ],
    })
    await t.container.transactions.run((tx) => t.container.audit.anonymize(tx, member.id))
    const rows = await prisma.auditRecord.findMany({ orderBy: { actionCode: 'asc' } })
    const yearAhead = new Date(NOW.getTime() + 365 * 86_400_000)
    expect(rows.filter((row) => row.targetMemberId === null).map((row) => row.purgeAfter)).toEqual(
      expect.arrayContaining([yearAhead, earlier]),
    )
    expect(rows.find((row) => row.targetMemberId === other.id)?.purgeAfter).toBeNull()
    expect(rows.every((row) => row.actorAdminId === admin.id)).toBe(true)
  })
})

describe('AccessPolicy', () => {
  it('shows a deleted account as Deleted User', async () => {
    const member = await createMember(t, { displayName: 'Selam' })
    const policy = t.container.accessPolicy
    const before = await t.container.transactions.run((tx) => policy.getMember(tx, member.id))
    expect(before.displayName).toBe('Selam')
    await t.container.prisma.memberAccount.update({
      where: { id: member.id },
      data: { state: 'DELETED', authUserId: null, email: null, displayName: null },
    })
    const after = await t.container.transactions.run((tx) => policy.lockMember(tx, member.id))
    expect(after).toMatchObject({ displayName: DELETED_USER_NAME, state: 'DELETED' })
    await expect(t.container.transactions.run((tx) => policy.getMember(tx, randomUUID()))).rejects.toThrow(
      'The member was not found.',
    )
  })

  it('rechecks publishing on the locked account row', async () => {
    const member = await createMember(t)
    const policy = t.container.accessPolicy
    const run = (actor: ActorContext) =>
      t.container.transactions.run((tx) => policy.assertCanPublish(tx, actor))
    await expect(run(memberActor(member.id))).resolves.toBeUndefined()
    // The restriction is read from the member's consequences, not from the request's ActorContext.
    await expect(run(memberActor(member.id, new Date(NOW.getTime() + 60_000)))).resolves.toBeUndefined()
    const violation = await t.container.prisma.violation.create({
      data: { memberId: member.id, targetType: 'POST', targetId: randomUUID(), decisionAt: NOW },
    })
    await t.container.prisma.consequence.create({
      data: {
        memberId: member.id,
        violationId: violation.id,
        kind: 'RESTRICTION',
        restrictUntil: new Date(NOW.getTime() + 60_000),
      },
    })
    await expect(run(memberActor(member.id))).rejects.toBeInstanceOf(RestrictionError)
    await t.container.prisma.memberAccount.update({ where: { id: member.id }, data: { state: 'DISABLED' } })
    await expect(run(memberActor(member.id))).rejects.toBeInstanceOf(PermissionDeniedError)
  })

  it('checks Students and mentor eligibility', async () => {
    const student = await createMember(t)
    const staff = await createMember(t, { role: 'STAFF' })
    const selfReported = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    const verified = await createMember(t, { role: 'ALUMNI', alumniStatus: 'VERIFIED' })
    const policy = t.container.accessPolicy
    const run = (work: Parameters<typeof t.container.transactions.run>[0]) =>
      t.container.transactions.run(work)
    await expect(run((tx) => policy.assertStudent(tx, student.id))).resolves.toBeUndefined()
    await expect(run((tx) => policy.assertStudent(tx, staff.id))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    await expect(run((tx) => policy.assertMentorEligible(tx, staff.id))).resolves.toBeUndefined()
    await expect(run((tx) => policy.assertMentorEligible(tx, verified.id))).resolves.toBeUndefined()
    await expect(run((tx) => policy.assertMentorEligible(tx, selfReported.id))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
    await expect(run((tx) => policy.assertMentorEligible(tx, student.id))).rejects.toBeInstanceOf(
      PermissionDeniedError,
    )
  })
})
