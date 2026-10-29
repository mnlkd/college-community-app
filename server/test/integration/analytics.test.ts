import type { DashboardSummaryView, QueueCountsView } from '@hilcoe/shared'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, type TestMember } from '../helpers/members.js'
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
})

const db = () => t.container.prisma
const daysAgo = (days: number, hour = 12) =>
  new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - days, hour))

async function post(author: TestMember, createdAt: Date) {
  return db().post.create({ data: { authorId: author.id, body: 'Secret body text', createdAt } })
}

async function comment(author: TestMember, postId: string, createdAt: Date) {
  return db().comment.create({ data: { postId, authorId: author.id, body: 'Secret comment', createdAt } })
}

/** Accounts, activity and pending queues that every test reads from. */
async function seedCommunity() {
  const amanuel = await createMember(t, { displayName: 'Amanuel Tesfaye', email: 'amanuel@hilcoeschool.com' })
  const selam = await createMember(t, { role: 'STAFF', displayName: 'Selam Haile' })
  const yonas = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED', displayName: 'Yonas' })
  const liya = await createMember(t, { role: 'ALUMNI', alumniStatus: 'VERIFIED', displayName: 'Liya' })
  const quiet = await createMember(t, { state: 'DISABLED', displayName: 'Quiet Member' })
  const gone = await createMember(t, { displayName: 'Gone Member' })
  await db().memberAccount.update({
    where: { id: gone.id },
    data: { state: 'DELETED', authUserId: null, email: null, displayName: null },
  })

  // Today and 3 days ago fall in both windows; 10 days ago only in 30; 40 days ago in neither.
  const recent = await post(amanuel, daysAgo(0, 8))
  await post(amanuel, daysAgo(3))
  const older = await post(selam, daysAgo(10))
  await post(yonas, daysAgo(40))
  await comment(liya, recent.id, daysAgo(3))
  await comment(selam, older.id, daysAgo(10))
  await db().like.create({
    data: { memberId: quiet.id, postId: recent.id, createdAt: daysAgo(2), updatedAt: daysAgo(2) },
  })
  await db().like.create({
    data: {
      memberId: yonas.id,
      postId: older.id,
      active: false,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  })

  await db().alumniReview.create({
    data: { memberId: yonas.id, registrationPath: 'PERSONAL_EMAIL', claimedFullName: 'Yonas Bekele' },
  })
  await db().graduationRequest.create({
    data: { memberId: amanuel.id, programme: 'COMPUTER_SCIENCE', graduationYear: 2026 },
  })
  await db().report.create({
    data: { reporterId: selam.id, targetType: 'POST', targetId: recent.id, targetVersion: 1, reason: 'SPAM' },
  })
  await db().opportunity.create({
    data: {
      authorId: selam.id,
      title: 'Backend Intern',
      organization: 'Kifiya',
      location: 'Addis Ababa',
      type: 'INTERNSHIP',
      workArrangement: 'HYBRID',
      description: 'Build payment APIs.',
      applyVia: 'careers@kifiya.example',
    },
  })
  await db().group.create({
    data: { ownerId: amanuel.id, title: 'Study circle', description: 'Weekly revision.', maxOccupancy: 6 },
  })
  await db().mentorship.create({
    data: { studentId: amanuel.id, mentorId: liya.id, topic: 'Careers', note: 'Hello', state: 'ACTIVE' },
  })
  return { amanuel, quiet }
}

describe('View Analytics and Export CSV', () => {
  it('summarizes the last 30 UTC days by default with counts only', async () => {
    const admin = await createAdmin(t)
    await createAdmin(t)
    await seedCommunity()

    const response = await api(t, admin.token).get('/api/admin/analytics')
    expect(response.status).toBe(200)
    const summary = response.body as DashboardSummaryView
    expect(summary).toMatchObject({
      windowDays: 30,
      from: '2026-09-02',
      to: '2026-10-01',
      accountCounts: {
        byRole: { STUDENT: 2, STAFF: 1, ALUMNI: 2 },
        byAlumniStatus: { SELF_REPORTED: 1, VERIFIED: 1, FLAGGED: 0 },
        byState: { ACTIVE: 4, DISABLED: 1, DELETED: 1 },
        communityAccounts: 5,
        administrators: 2,
      },
      // amanuel, selam, liya (comment), quiet (active like); yonas only posted 40 days ago.
      activeMembers: 4,
      totalPosts: 3,
      totalComments: 2,
      pendingReports: 1,
      pendingAlumniReviews: 1,
      pendingGraduationRequests: 1,
      openOpportunities: 1,
      activeGroups: 1,
      activeMentorships: 1,
    })
    expect(summary.dailyActivity).toHaveLength(30)
    expect(summary.dailyActivity[0]).toEqual({ date: '2026-09-02', posts: 0, comments: 0 })
    expect(summary.dailyActivity.at(-1)).toEqual({ date: '2026-10-01', posts: 1, comments: 0 })
    expect(summary.dailyActivity.find((day) => day.date === '2026-09-28')).toEqual({
      date: '2026-09-28',
      posts: 1,
      comments: 1,
    })
    const text = JSON.stringify(summary)
    for (const secret of ['Amanuel', 'amanuel@', 'Secret', 'Yonas Bekele', 'Kifiya', 'Study circle']) {
      expect(text).not.toContain(secret)
    }
  })

  it('narrows to a 7-day window and rejects other windows', async () => {
    const admin = await createAdmin(t)
    await seedCommunity()
    const week = (await api(t, admin.token).get('/api/admin/analytics?windowDays=7'))
      .body as DashboardSummaryView
    expect(week).toMatchObject({
      windowDays: 7,
      from: '2026-09-25',
      totalPosts: 2,
      totalComments: 1,
      activeMembers: 3,
    })
    expect(week.dailyActivity).toHaveLength(7)

    const invalid = await api(t, admin.token).get('/api/admin/analytics?windowDays=14')
    expect(invalid.status).toBe(422)
    expect(invalid.body.error.fields).toHaveProperty('windowDays')
  })

  it('exports the aggregates as a CSV attachment without names, emails or content', async () => {
    const admin = await createAdmin(t)
    await seedCommunity()
    const response = await api(t, admin.token).get('/api/admin/analytics/export.csv?windowDays=7')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^text\/csv/)
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="hilcoe-commons-aggregates-7d-2026-10-01.csv"',
    )
    const lines = response.text.split('\r\n')
    expect(lines[0]).toBe('metric,window_days,utc_date,count')
    expect(lines).toContain('community_accounts,7,,5')
    expect(lines).toContain('accounts_role_student,7,,2')
    expect(lines).toContain('accounts_alumni_verified,7,,1')
    expect(lines).toContain('active_members,7,,3')
    expect(lines).toContain('pending_reports,7,,1')
    expect(lines).toContain('daily_posts,7,2026-10-01,1')
    expect(lines).toContain('daily_comments,7,2026-09-28,1')
    expect(lines.filter((line) => line.startsWith('daily_posts,'))).toHaveLength(7)
    expect(lines.at(-1)).toBe('')
    for (const line of lines.slice(1, -1)) expect(line).toMatch(/^[a-z_]+,7,(\d{4}-\d{2}-\d{2})?,\d+$/)
  })

  it('gives the queue counts for the Administrator navigation', async () => {
    const admin = await createAdmin(t)
    await seedCommunity()
    const response = await api(t, admin.token).get('/api/admin/queue-counts')
    expect(response.status).toBe(200)
    expect(response.body as QueueCountsView).toEqual({
      pendingReports: 1,
      pendingAlumniReviews: 1,
      pendingGraduationRequests: 1,
    })
  })

  it('is for Administrators only', async () => {
    const { amanuel } = await seedCommunity()
    for (const path of [
      '/api/admin/analytics',
      '/api/admin/analytics/export.csv',
      '/api/admin/queue-counts',
    ]) {
      expect((await api(t, amanuel.token).get(path)).status).toBe(403)
      expect((await request(t.app).get(path)).status).toBe(401)
    }
  })

  it('limits CSV exports per Administrator', async () => {
    const admin = await createAdmin(t)
    expect((await api(t, admin.token).get('/api/admin/analytics/export.csv')).status).toBe(200)
    for (let index = 1; index < 30; index += 1) t.container.rateLimiter.check('analytics.export', admin.id)
    const limited = await api(t, admin.token).get('/api/admin/analytics/export.csv')
    expect(limited.status).toBe(429)
    expect((await api(t, admin.token).get('/api/admin/analytics')).status).toBe(200)
  })
})
