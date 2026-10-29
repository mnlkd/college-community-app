import type {
  AuditRecordView,
  ConsequenceView,
  DecisionResultView,
  NotificationView,
  Page,
  PostView,
  ReportDetailView,
  ReportSummaryView,
  ReportView,
} from '@hilcoe/shared'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActorContext, RestrictionError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import {
  api,
  createAdmin,
  createMember,
  NOW,
  PASSWORD,
  type TestAdmin,
  type TestMember,
} from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

vi.setConfig({ testTimeout: 180_000 })

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  t.storage.files.clear()
  await resetDatabase(t.container.prisma)
})

const DAY = 86_400_000
const db = () => t.container.prisma
const as = (who: { token: string }) => api(t, who.token)
const reason = 'Breaches the harassment guideline.'

const png = () =>
  sharp({ create: { width: 40, height: 30, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

/** Multipart create (POST) or edit (PUT) of a post with image files. */
async function sendPost(
  member: TestMember,
  method: 'post' | 'put',
  path: string,
  post: object,
  files: Buffer[],
) {
  const agent = request(t.app)
  let call = (method === 'post' ? agent.post(path) : agent.put(path))
    .set('Authorization', `Bearer ${member.token}`)
    .field('post', JSON.stringify(post))
  files.forEach((file, index) => {
    call = call.attach('images', file, `image-${index}.png`)
  })
  return call
}

async function createPost(member: TestMember, body = 'A post to report'): Promise<PostView> {
  const response = await as(member).post('/api/posts', { body, tags: [] })
  expect(response.status).toBe(201)
  return response.body as PostView
}

async function report(
  reporter: TestMember,
  targetId: string,
  targetType: 'POST' | 'COMMENT' | 'OPPORTUNITY' = 'POST',
  extra: object = {},
) {
  return as(reporter).post('/api/reports', { targetType, targetId, reason: 'HARASSMENT', ...extra })
}

async function reportOk(
  reporter: TestMember,
  targetId: string,
  targetType?: 'POST' | 'COMMENT' | 'OPPORTUNITY',
) {
  const response = await report(reporter, targetId, targetType)
  expect(response.status).toBe(201)
  return response.body as ReportView
}

async function decide(admin: TestAdmin, reportId: string, decision: 'UPHELD' | 'DISMISSED') {
  const response = await as(admin).post(`/api/admin/reports/${reportId}/decision`, { decision, reason })
  expect(response.status).toBe(200)
  return response.body as DecisionResultView
}

async function detail(admin: TestAdmin, reportId: string): Promise<ReportDetailView> {
  const response = await as(admin).get(`/api/admin/reports/${reportId}`)
  expect(response.status).toBe(200)
  return response.body as ReportDetailView
}

async function notices(member: TestMember): Promise<NotificationView[]> {
  return ((await as(member).get('/api/notifications')).body as Page<NotificationView>).items
}

describe('Report Content', () => {
  it('records a private report with a snapshot and lists it in the reporter history only', async () => {
    const author = await createMember(t, { displayName: 'Author' })
    const reporter = await createMember(t, { displayName: 'Reporter' })
    const other = await createMember(t)
    const admin = await createAdmin(t)
    const post = await createPost(author, 'Offensive words')

    const created = await reportOk(reporter, post.id)
    expect(created).toMatchObject({ targetType: 'POST', targetId: post.id, state: 'PENDING', details: null })

    const mine = (await as(reporter).get('/api/reports/mine')).body as Page<ReportView>
    expect(mine.items.map((item) => item.id)).toEqual([created.id])
    expect(((await as(other).get('/api/reports/mine')).body as Page<ReportView>).items).toEqual([])
    expect((await as(admin).get('/api/reports/mine')).status).toBe(403)
    expect((await as(reporter).get('/api/admin/reports')).status).toBe(403)

    const queue = (await as(admin).get('/api/admin/reports')).body as Page<ReportSummaryView>
    expect(queue.items).toHaveLength(1)
    expect(queue.items[0]).toMatchObject({
      excerpt: 'Offensive words',
      author: { displayName: 'Author' },
      reporter: { displayName: 'Reporter' },
      authorPriorViolations: 0,
    })
    const opened = await detail(admin, created.id)
    expect(opened).toMatchObject({
      evidence: { snapshotText: 'Offensive words', images: [] },
      evidenceExpired: false,
      consequencePreview: 'WARNING',
      otherPendingReports: 0,
      postId: post.id,
      decision: null,
    })
    // The author is not told about a pending report.
    expect(await notices(author)).toEqual([])
  })

  it('validates the input and refuses own, missing, archived and hidden content', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const post = await createPost(author)

    const long = await report(reporter, post.id, 'POST', { details: 'x'.repeat(1001) })
    expect(long.status).toBe(422)
    expect(long.body.error.fields).toHaveProperty('details')
    expect((await report(reporter, post.id, 'POST', { reason: 'RUDENESS' })).status).toBe(422)
    expect((await report(reporter, 'not-a-uuid')).status).toBe(422)
    expect((await report(reporter, crypto.randomUUID())).status).toBe(404)
    expect((await report(author, post.id)).status).toBe(403)

    const blank = await report(reporter, post.id, 'POST', { details: '   ' })
    expect(blank.status).toBe(201)
    expect(blank.body.details).toBeNull()

    // An archived post has nothing left to report, but its comments can be reported.
    const archived = await createPost(author)
    const comment = await as(reporter).post(`/api/posts/${archived.id}/comments`, { body: 'Rude reply' })
    expect(comment.status).toBe(201)
    await as(author).delete(`/api/posts/${archived.id}`).expect(204)
    expect((await report(reporter, archived.id)).status).toBe(409)
    await reportOk(author, comment.body.id, 'COMMENT')

    // A deleted comment cannot be reported; a hidden one does not exist for others.
    const gone = await as(author).post(`/api/posts/${post.id}/comments`, { body: 'Soon gone' })
    await as(author).delete(`/api/comments/${gone.body.id}`).expect(204)
    expect((await report(reporter, gone.body.id, 'COMMENT')).status).toBe(409)
    await db().post.update({ where: { id: post.id }, data: { state: 'HIDDEN' } })
    expect((await report(await createMember(t), post.id)).status).toBe(404)
  })

  it('requires canInteract but allows a restricted member to report', async () => {
    const author = await createMember(t)
    const post = await createPost(author)
    const flagged = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    expect((await report(flagged, post.id)).status).toBe(403)

    const restricted = await createMember(t)
    const violation = await db().violation.create({
      data: { memberId: restricted.id, targetType: 'POST', targetId: crypto.randomUUID(), decisionAt: NOW },
    })
    await db().consequence.create({
      data: {
        memberId: restricted.id,
        violationId: violation.id,
        kind: 'RESTRICTION',
        restrictUntil: new Date(NOW.getTime() + 14 * DAY),
      },
    })
    expect((await report(restricted, post.id)).status).toBe(201)
  })

  it('refuses a second pending report on the same item, also when submitted concurrently', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const post = await createPost(author)
    const results = await Promise.all([report(reporter, post.id), report(reporter, post.id)])
    expect(results.map((result) => result.status).sort()).toEqual([201, 409])
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe('DUPLICATE')
    expect((await report(reporter, post.id)).body.error.code).toBe('DUPLICATE')
    expect(await db().report.count()).toBe(1)
  })

  it('keeps the snapshot and held images unchanged by later edits and deletion', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const created = await sendPost(
      author,
      'post',
      '/api/posts',
      {
        body: 'Original text',
        tags: [],
        images: [
          { imageId: null, altText: 'First' },
          { imageId: null, altText: 'Second' },
        ],
      },
      [await png(), await png()],
    )
    expect(created.status).toBe(201)
    const post = created.body as PostView
    const filed = await reportOk(reporter, post.id)

    // The author drops the first image and changes the text.
    const [first, second] = post.images
    const edited = await sendPost(
      author,
      'put',
      `/api/posts/${post.id}`,
      {
        body: 'Edited text',
        tags: [],
        version: post.version,
        images: [{ imageId: second?.id, altText: 'Second' }],
      },
      [],
    )
    expect(edited.status).toBe(200)
    expect((edited.body as PostView).images.map((image) => image.id)).toEqual([second?.id])

    let evidence = (await detail(admin, filed.id)).evidence
    expect(evidence?.snapshotText).toBe('Original text')
    expect(evidence?.images.map((image) => image.altText)).toEqual(['First', 'Second'])
    const held = await db().postImage.findMany({ where: { postId: post.id }, orderBy: { id: 'asc' } })
    expect(held.map((image) => [image.id, image.position, image.evidenceHold])).toEqual([
      [first?.id, null, true],
      [second?.id, 1, true],
    ])
    expect(held.every((image) => t.storage.files.has(image.storageKey))).toBe(true)

    // The author archives the post: the held files stay for the evidence.
    await as(author).delete(`/api/posts/${post.id}`).expect(204)
    evidence = (await detail(admin, filed.id)).evidence
    expect(evidence?.snapshotText).toBe('Original text')
    expect(evidence?.images).toHaveLength(2)
    expect(held.every((image) => t.storage.files.has(image.storageKey))).toBe(true)
  })

  it('lets a closed listing be reported', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const listing = await as(staff).post('/api/opportunities', {
      title: 'Fake internship',
      organization: 'Nowhere',
      location: 'Addis Ababa',
      type: 'INTERNSHIP',
      workArrangement: 'REMOTE',
      description: 'Send a fee to apply.',
      applyVia: 'scam@example.com',
      deadline: '',
    })
    expect(listing.status).toBe(201)
    await as(staff).post(`/api/opportunities/${listing.body.id}/closure`).expect(204)
    const filed = await reportOk(reporter, listing.body.id, 'OPPORTUNITY')
    const opened = await detail(admin, filed.id)
    expect(opened.evidence?.snapshotText).toContain('Fake internship')
    expect(opened.evidence?.snapshotText).toContain('Send a fee to apply.')
    expect(opened.postId).toBeNull()

    await decide(admin, filed.id, 'UPHELD')
    expect((await db().opportunity.findUniqueOrThrow({ where: { id: listing.body.id } })).state).toBe(
      'HIDDEN',
    )
    expect((await as(reporter).get(`/api/opportunities/${listing.body.id}`)).status).toBe(404)
  })
})

describe('Review Report and Apply Consequence', () => {
  it('upholds several reports on one item as one violation with a warning, and hides it', async () => {
    const author = await createMember(t)
    const reporters = [await createMember(t), await createMember(t), await createMember(t)]
    const reader = await createMember(t)
    const admin = await createAdmin(t)
    const post = await createPost(author)
    const filed = []
    for (const reporter of reporters) filed.push(await reportOk(reporter, post.id))
    expect((await detail(admin, filed[0]!.id)).otherPendingReports).toBe(2)

    const result = await decide(admin, filed[1]!.id, 'UPHELD')
    expect(result).toMatchObject({
      reportId: filed[1]!.id,
      state: 'UPHELD',
      outcome: 'UPHELD_WARNING',
      resolvedReports: 3,
      consequence: { kind: 'WARNING', restrictUntil: null },
    })
    expect(await db().report.count({ where: { state: 'UPHELD', decidedAt: NOW } })).toBe(3)
    expect(await db().violation.count()).toBe(1)
    expect(await db().consequence.count()).toBe(1)

    // Hidden from everyone but its author.
    expect((await as(reader).get(`/api/posts/${post.id}`)).status).toBe(404)
    expect((await as(author).get(`/api/posts/${post.id}`)).body.state).toBe('HIDDEN')

    // Deciding a resolved report again is refused.
    const again = await as(admin).post(`/api/admin/reports/${filed[0]!.id}/decision`, {
      decision: 'DISMISSED',
      reason,
    })
    expect(again.status).toBe(409)

    // Notices name neither the reporters nor the Administrator.
    const authorNotices = await notices(author)
    expect(authorNotices).toHaveLength(1)
    expect(authorNotices[0]).toMatchObject({ type: 'MODERATION_OUTCOME', actorId: null, actorName: null })
    for (const reporter of reporters) {
      const [notice] = await notices(reporter)
      expect(notice).toMatchObject({ type: 'REPORT_OUTCOME', actorId: null, actorName: null })
    }
    const consequences = (await as(author).get('/api/consequences/mine')).body as ConsequenceView[]
    expect(consequences).toEqual([
      expect.objectContaining({
        kind: 'WARNING',
        targetType: 'POST',
        targetId: post.id,
        restrictUntil: null,
      }),
    ])
    expect(JSON.stringify(consequences)).not.toContain(admin.id)
  })

  it('gives a 14-day restriction for a later violation, applied inside the publishing transaction', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const first = await reportOk(reporter, (await createPost(author, 'first')).id)
    await decide(admin, first.id, 'UPHELD')
    const comment = await as(author).post(`/api/posts/${(await createPost(reporter)).id}/comments`, {
      body: 'rude',
    })
    const second = await reportOk(reporter, comment.body.id, 'COMMENT')
    expect((await detail(admin, second.id)).consequencePreview).toBe('RESTRICTION')
    expect(
      (await as(admin).get('/api/admin/reports?state=PENDING')).body.items[0].authorPriorViolations,
    ).toBe(1)

    t.clock.advance(60_000)
    const restrictedAt = t.clock.now()
    const result = await decide(admin, second.id, 'UPHELD')
    const until = new Date(restrictedAt.getTime() + 14 * DAY).toISOString()
    expect(result).toMatchObject({
      outcome: 'UPHELD_RESTRICTION',
      consequence: { kind: 'RESTRICTION', restrictUntil: until },
    })
    expect((await as(author).get(`/api/comments/${comment.body.id}`)).status).toBe(404)

    const refused = await as(author).post('/api/posts', { body: 'still here', tags: [] })
    expect(refused.status).toBe(403)
    expect(refused.body.error.code).toBe('RESTRICTED')

    // A request authorised before the decision is still refused inside the transaction.
    const stale = new ActorContext({
      accountId: author.id,
      kind: 'MEMBER',
      role: 'STUDENT',
      alumniStatus: null,
      accountState: 'ACTIVE',
      restrictedUntil: null,
      mfaVerified: false,
      isFirstAdmin: false,
      sessionId: null,
    })
    await expect(
      t.container.transactions.run((tx) => t.container.accessPolicy.assertCanPublish(tx, stale)),
    ).rejects.toBeInstanceOf(RestrictionError)

    t.clock.advance(14 * DAY)
    expect((await as(author).post('/api/posts', { body: 'back again', tags: [] })).status).toBe(201)
  })

  it('dismisses with a notice to the reporter only and no consequence', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const reader = await createMember(t)
    const admin = await createAdmin(t)
    const post = await createPost(author)
    const filed = await reportOk(reporter, post.id)
    const result = await decide(admin, filed.id, 'DISMISSED')
    expect(result).toMatchObject({
      state: 'DISMISSED',
      outcome: 'DISMISSED',
      resolvedReports: 1,
      consequence: null,
    })
    expect(await db().violation.count()).toBe(0)
    expect((await as(reader).get(`/api/posts/${post.id}`)).status).toBe(200)
    expect(await notices(author)).toEqual([])
    expect((await notices(reporter)).map((notice) => notice.type)).toEqual(['REPORT_OUTCOME'])
    expect(((await as(reporter).get('/api/reports/mine')).body as Page<ReportView>).items[0]?.state).toBe(
      'DISMISSED',
    )
    const opened = await detail(admin, filed.id)
    expect(opened).toMatchObject({
      consequencePreview: null,
      decision: { outcome: 'DISMISSED', reason, decidedAt: NOW.toISOString() },
    })
  })

  it('validates the decision and refuses members', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const filed = await reportOk(reporter, (await createPost(author)).id)
    const path = `/api/admin/reports/${filed.id}/decision`
    expect((await as(admin).post(path, { decision: 'UPHELD', reason: '  ' })).status).toBe(422)
    expect((await as(admin).post(path, { decision: 'MAYBE', reason })).status).toBe(422)
    expect((await as(reporter).post(path, { decision: 'UPHELD', reason })).status).toBe(403)
    expect((await as(admin).get('/api/admin/reports/nope')).status).toBe(404)
    expect((await as(admin).get(`/api/admin/reports/${crypto.randomUUID()}`)).status).toBe(404)
  })

  it('upholds against a deleted author without a consequence and keeps a deleted reporter anonymous', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const post = await createPost(author)
    const filed = await reportOk(reporter, post.id)
    await as(reporter).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)

    const pending = await detail(admin, filed.id)
    expect(pending.reporter).toMatchObject({ memberId: null, deleted: true })
    expect(pending.evidence?.snapshotText).toBe('A post to report')
    expect((await db().report.findUniqueOrThrow({ where: { id: filed.id } })).reporterId).toBeNull()

    await as(author).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect((await detail(admin, filed.id)).consequencePreview).toBe('NONE')
    const result = await decide(admin, filed.id, 'UPHELD')
    expect(result).toMatchObject({ outcome: 'UPHELD_NO_CONSEQUENCE', consequence: null })
    expect(await db().violation.count()).toBe(1)
    expect(await db().consequence.count()).toBe(0)
  })
})

describe('Moderation evidence retention', () => {
  it('refuses the evidence seven days after the decision even before cleanup runs', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    // Administrator sessions end after inactivity, so each step signs in a fresh one.
    const reviewer = () => createAdmin(t)
    const filed = await reportOk(reporter, (await createPost(author, 'Kept a week')).id)
    t.clock.advance(30 * DAY)
    expect((await detail(await reviewer(), filed.id)).evidence?.snapshotText).toBe('Kept a week')

    await decide(await reviewer(), filed.id, 'DISMISSED')
    t.clock.advance(7 * DAY - 1000)
    expect((await detail(await reviewer(), filed.id)).evidence?.snapshotText).toBe('Kept a week')
    t.clock.advance(1000)
    const expired = await detail(await reviewer(), filed.id)
    expect(expired).toMatchObject({ evidence: null, evidenceExpired: true, excerpt: null })
    const queue = (await as(await reviewer()).get('/api/admin/reports?state=DISMISSED'))
      .body as Page<ReportSummaryView>
    expect(queue.items[0]?.excerpt).toBeNull()
  })
})

describe('Audit log', () => {
  it('records each decision with its outcome and lists records with filters', async () => {
    const author = await createMember(t, { displayName: 'Author' })
    const reporter = await createMember(t)
    const first = await createAdmin(t)
    const one = await reportOk(reporter, (await createPost(author)).id)
    const two = await reportOk(reporter, (await createPost(author)).id)
    const upheld = await decide(first, one.id, 'UPHELD')
    t.clock.advance(2 * DAY)
    const admin = await createAdmin(t)
    await decide(admin, two.id, 'DISMISSED')

    const all = (await as(admin).get('/api/admin/audit-records')).body as Page<AuditRecordView>
    expect(all.items.map((item) => item.outcome)).toEqual(['DISMISSED', 'UPHELD_WARNING'])
    expect(all.items[1]).toMatchObject({
      id: upheld.auditRecordId,
      action: 'REPORT_DECIDED',
      actor: { adminId: first.id, email: first.email },
      targetMember: { memberId: author.id, displayName: 'Author' },
      reason,
      reportId: one.id,
      anonymized: false,
    })
    const byAdmin = (await as(admin).get(`/api/admin/audit-records?adminId=${first.id}`)).body
    expect(byAdmin.items).toHaveLength(1)
    const byDay = (await as(admin).get('/api/admin/audit-records?from=2026-10-01&to=2026-10-01')).body
    expect(byDay.items.map((item: AuditRecordView) => item.reportId)).toEqual([one.id])
    const byMember = (
      await as(admin).get(`/api/admin/audit-records?memberId=${author.id}&action=REPORT_DECIDED`)
    ).body
    expect(byMember.total).toBe(2)
    expect((await as(admin).get('/api/admin/audit-records?action=REPORT_DECIDED&from=&to=')).body.total).toBe(
      2,
    )
    const backwards = await as(admin).get('/api/admin/audit-records?from=2026-10-03&to=2026-10-01')
    expect(backwards.status).toBe(422)
    expect(backwards.body.error.fields).toHaveProperty('to')
    expect((await as(reporter).get('/api/admin/audit-records')).status).toBe(403)
  })

  it('is append-only, except for anonymizing a deleted account', async () => {
    const author = await createMember(t)
    const reporter = await createMember(t)
    const admin = await createAdmin(t)
    const filed = await reportOk(reporter, (await createPost(author)).id)
    const { auditRecordId } = await decide(admin, filed.id, 'UPHELD')

    await expect(
      db().$executeRaw`UPDATE audit_record SET reason = 'changed' WHERE id = ${auditRecordId}::uuid`,
    ).rejects.toThrow(/append-only/)
    await expect(
      db().$executeRaw`UPDATE audit_record SET occurred_at = now() WHERE id = ${auditRecordId}::uuid`,
    ).rejects.toThrow(/append-only/)
    await expect(
      db().$executeRaw`DELETE FROM audit_record WHERE id = ${auditRecordId}::uuid`,
    ).rejects.toThrow(/append-only/)

    await as(author).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    const [record] = ((await as(admin).get('/api/admin/audit-records')).body as Page<AuditRecordView>).items
    expect(record).toMatchObject({ id: auditRecordId, targetMember: null, anonymized: true, reason })
    const row = await db().auditRecord.findUniqueOrThrow({ where: { id: auditRecordId } })
    expect(row.purgeAfter?.getTime()).toBe(NOW.getTime() + 365 * DAY)
  })
})
