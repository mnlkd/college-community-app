import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CleanupJob } from '../../src/infrastructure/cleanup-job.js'
import { resetDatabase } from '../helpers/database.js'
import { createAdmin, createMember, NOW, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

vi.setConfig({ testTimeout: 120_000 })

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  await resetDatabase(t.container.prisma)
  t.storage.files.clear()
  t.authProvider.users.clear()
  t.inventory.createdAt.clear()
})

const db = () => t.container.prisma
const DAY = 86_400_000
const LONG_AGO = new Date('2020-01-01T00:00:00Z')
const file = (key: string) =>
  t.storage.files.set(key, { bytes: new Uint8Array([1]), contentType: 'image/webp' })

async function image(post: { id: string }, member: TestMember, position: number | null, evidenceHold = true) {
  const key = `post-images/${member.id}/${randomUUID()}.webp`
  file(key)
  return db().postImage.create({ data: { postId: post.id, storageKey: key, position, evidenceHold } })
}

async function report(reporter: TestMember, targetId: string, state: 'PENDING' | 'DISMISSED') {
  return db().report.create({
    data: {
      reporterId: reporter.id,
      targetType: 'POST',
      targetId,
      targetVersion: 1,
      reason: 'SPAM',
      state,
      decidedAt: state === 'PENDING' ? null : NOW,
    },
  })
}

describe('CleanupJob', () => {
  it('purges expired notices and earlier view marks only', async () => {
    const reader = await createMember(t)
    const author = await createMember(t)
    const post = await db().post.create({ data: { authorId: author.id, body: 'Hello' } })
    const notice = (expiresAt: Date) => ({
      recipientId: reader.id,
      type: 'COMMENT' as const,
      eventKey: `comment:${randomUUID()}`,
      targetType: 'POST',
      targetId: post.id,
      expiresAt,
    })
    await db().notification.createMany({
      data: [notice(new Date(NOW.getTime() - 1)), notice(NOW), notice(new Date(NOW.getTime() + DAY))],
    })
    await db().postViewDay.createMany({
      data: [
        { memberId: reader.id, postId: post.id, utcDate: new Date('2026-09-30') },
        { memberId: reader.id, postId: post.id, utcDate: new Date('2026-10-01') },
      ],
    })

    const summary = await t.container.cleanup.run(NOW)
    expect(summary).toMatchObject({ notifications: 2, viewMarks: 1, failedSteps: [] })
    expect(await db().notification.count()).toBe(1)
    expect((await db().postViewDay.findMany()).map((row) => row.utcDate.toISOString().slice(0, 10))).toEqual([
      '2026-10-01',
    ])
  })

  it('removes evidence after its seven days and releases the images no evidence holds', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const post = await db().post.create({ data: { authorId: author.id, body: 'Reported' } })
    const shown = await image(post, author, 1)
    const dropped = await image(post, author, null)
    const shared = await image(post, author, null)
    const decided = await report(reporter, post.id, 'DISMISSED')
    const pending = await report(await createMember(t), post.id, 'PENDING')
    await db().moderationEvidence.createMany({
      data: [
        { reportId: decided.id, snapshotText: 'Reported', purgeAfter: new Date(NOW.getTime() - 1) },
        { reportId: decided.id, imageRef: shown.id, purgeAfter: new Date(NOW.getTime() - 1) },
        { reportId: decided.id, imageRef: dropped.id, purgeAfter: new Date(NOW.getTime() - 1) },
        { reportId: decided.id, imageRef: shared.id, purgeAfter: new Date(NOW.getTime() - 1) },
        { reportId: pending.id, imageRef: shared.id },
      ],
    })
    const later = await report(reporter, randomUUID(), 'DISMISSED')
    await db().moderationEvidence.create({
      data: { reportId: later.id, snapshotText: 'Kept', purgeAfter: new Date(NOW.getTime() + DAY) },
    })

    const summary = await t.container.cleanup.run(NOW)
    expect(summary).toMatchObject({ evidence: 4, evidenceImages: 1, failedSteps: [] })
    expect(await db().moderationEvidence.count()).toBe(2)
    const images = await db().postImage.findMany({ select: { id: true, evidenceHold: true } })
    expect(images).toEqual(
      expect.arrayContaining([
        { id: shown.id, evidenceHold: false },
        { id: shared.id, evidenceHold: true },
      ]),
    )
    expect(images).toHaveLength(2)
    expect(t.storage.files.size).toBe(2)
  })

  it('removes the held images of a post its author deleted', async () => {
    const author = await createMember(t)
    const post = await db().post.create({ data: { authorId: author.id, body: null, state: 'ARCHIVED' } })
    const held = await image(post, author, 1)
    const decided = await report(await createMember(t), post.id, 'DISMISSED')
    await db().moderationEvidence.create({
      data: { reportId: decided.id, imageRef: held.id, purgeAfter: new Date(NOW.getTime() - 1) },
    })
    expect(await t.container.cleanup.run(NOW)).toMatchObject({ evidenceImages: 1 })
    expect(await db().postImage.count()).toBe(0)
    expect(t.storage.files.size).toBe(0)
  })

  it('removes audit records whose purge date has passed', async () => {
    const admin = await createAdmin(t)
    await db().auditRecord.createMany({
      data: [
        { actorAdminId: admin.id, actionCode: 'REPORT_DECIDED', purgeAfter: LONG_AGO },
        { actorAdminId: admin.id, actionCode: 'REPORT_DECIDED', purgeAfter: new Date('2999-01-01') },
        { actorAdminId: admin.id, actionCode: 'REPORT_DECIDED' },
      ],
    })
    expect(await t.container.cleanup.run(NOW)).toMatchObject({ auditRecords: 1, failedSteps: [] })
    expect(await db().auditRecord.count()).toBe(2)
  })

  it('sweeps stored files and auth users the platform no longer refers to', async () => {
    const member = await createMember(t)
    const admin = await createAdmin(t)
    const post = await db().post.create({ data: { authorId: member.id, body: 'With picture' } })
    const kept = await image(post, member, 1, false)
    const profileKey = `profile-images/${member.id}/${randomUUID()}.webp`
    file(profileKey)
    await db().profile.update({
      where: { memberId: member.id },
      data: { profileImage: { create: { memberId: member.id, storageKey: profileKey } } },
    })
    const orphan = `post-images/${member.id}/${randomUUID()}.webp`
    const fresh = `post-images/${member.id}/${randomUUID()}.webp`
    file(orphan)
    file(fresh)
    t.inventory.createdAt.set(fresh, new Date(NOW.getTime() - 60_000))

    const invited = t.authProvider.addUser('invited@hilcoeschool.com')
    invited.accountKind = 'ADMIN'
    const recentInvite = t.authProvider.addUser('recent@hilcoeschool.com')
    recentInvite.accountKind = 'ADMIN'
    t.inventory.createdAt.set(recentInvite.id, new Date(NOW.getTime() - 60_000))
    const unregistered = t.authProvider.addUser('signup@gmail.com')

    const summary = await t.container.cleanup.run(NOW)
    expect(summary).toMatchObject({ orphanFiles: 1, orphanAuthUsers: 1, failedSteps: [] })
    expect([...t.storage.files.keys()].sort()).toEqual([kept.storageKey, profileKey, fresh].sort())
    expect([...t.authProvider.users.keys()].sort()).toEqual(
      [member.authUserId, admin.authUserId, recentInvite.id, unregistered.id].sort(),
    )
  })

  it('reads the inventory page by page and keeps going when a step fails', async () => {
    const member = await createMember(t)
    const keys = Array.from({ length: 5 }, () => `post-images/${member.id}/${randomUUID()}.webp`)
    keys.forEach(file)
    const job = new CleanupJob({
      ...(t.container.cleanup as unknown as { deps: ConstructorParameters<typeof CleanupJob>[0] }).deps,
      pageSize: 2,
    })
    t.authProvider.failNextDelete = true
    const orphanUser = t.authProvider.addUser('orphan@hilcoeschool.com')
    orphanUser.accountKind = 'MEMBER'
    const failing = vi
      .spyOn(t.container.notifications, 'purgeExpired')
      .mockRejectedValueOnce(new Error('down'))

    const summary = await job.run(NOW)
    failing.mockRestore()
    expect(summary).toMatchObject({ orphanFiles: 5, orphanAuthUsers: 0, failedSteps: ['notifications'] })
    expect(t.storage.files.size).toBe(0)
    expect(t.authProvider.users.has(orphanUser.id)).toBe(true)
    expect(await job.run(NOW)).toMatchObject({ orphanAuthUsers: 1, failedSteps: [] })
  })

  it('joins a run already in progress', async () => {
    const [first, second] = [t.container.cleanup.run(NOW), t.container.cleanup.run(NOW)]
    expect(await first).toBe(await second)
  })
})
