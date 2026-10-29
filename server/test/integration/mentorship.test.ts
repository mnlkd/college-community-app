import { randomUUID } from 'node:crypto'
import type { MentorshipView, MentorSummaryView, Page } from '@hilcoe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, PASSWORD, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

// Many requests per test against the hosted test database; a timed-out test would keep writing
// into the next file's tests, so allow ample time.
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
const as = (member: TestMember) => api(t, member.token)

const settings = (overrides: object = {}) => ({
  available: true,
  capacity: 2,
  introduction: 'Backend engineer happy to review projects.',
  topics: ['Backend APIs', 'Career advice'],
  contacts: [{ kind: 'TELEGRAM', value: '@mentor' }],
  ...overrides,
})

async function createMentor(
  options: { role?: 'STAFF' | 'ALUMNI'; displayName?: string; settings?: object } = {},
): Promise<TestMember> {
  const mentor = await createMember(t, {
    role: options.role ?? 'STAFF',
    displayName: options.displayName ?? 'Meseret',
  })
  await as(mentor).put('/api/mentors/me', settings(options.settings)).expect(200)
  return mentor
}

async function requestMentor(student: TestMember, mentor: TestMember, topic = 'Backend APIs') {
  const response = await as(student).post(`/api/mentors/${mentor.id}/mentorships`, {
    topic,
    note: 'I would like help with my final-year project.',
  })
  expect(response.status).toBe(201)
  return response.body as MentorshipView
}

async function activeMentorship(
  student: TestMember,
  mentor: TestMember,
  topic?: string,
): Promise<MentorshipView> {
  const request = await requestMentor(student, mentor, topic)
  await as(mentor).post(`/api/mentorships/${request.id}/acceptance`).expect(200)
  return request
}

const state = async (id: string) => (await db().mentorship.findUniqueOrThrow({ where: { id } })).state
const notices = (recipientId: string) =>
  db().notification.findMany({
    where: { recipientId },
    select: { type: true, eventKey: true, actorId: true, targetType: true, targetId: true },
    orderBy: { createdAt: 'asc' },
  })
const mentorIds = (page: Page<MentorSummaryView>) => page.items.map((item) => item.mentor.memberId)

describe('Manage Mentor Availability', () => {
  it('lets Staff and Verified Alumni save settings and read their contacts back', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const before = await as(staff).get('/api/mentors/me')
    expect(before.status).toBe(200)
    expect(before.body).toMatchObject({ configured: false, available: false, contacts: [] })

    const saved = await as(staff).put(
      '/api/mentors/me',
      settings({ contacts: [{ kind: 'EMAIL', value: ' Mentor@Example.com ' }] }),
    )
    expect(saved.status).toBe(200)
    expect(saved.body).toMatchObject({
      configured: true,
      available: true,
      capacity: 2,
      topics: ['Backend APIs', 'Career advice'],
      contacts: [{ kind: 'EMAIL', value: 'mentor@example.com' }],
      activeCount: 0,
      pendingCount: 0,
    })
    const alumni = await createMember(t, { role: 'ALUMNI', alumniStatus: 'VERIFIED' })
    expect((await as(alumni).put('/api/mentors/me', settings())).status).toBe(200)
  })

  it('refuses Students, Self-Reported and Flagged Alumni', async () => {
    const members = [
      await createMember(t),
      await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' }),
      await createMember(t, { role: 'ALUMNI', alumniStatus: 'FLAGGED' }),
    ]
    for (const member of members) {
      expect((await as(member).put('/api/mentors/me', settings())).status).toBe(403)
      expect((await as(member).get('/api/mentors/me')).status).toBe(403)
    }
    expect(await db().mentorProfile.count()).toBe(0)
  })

  it('validates capacity, topics and contacts without saving anything', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    for (const bad of [
      settings({ contacts: [] }),
      settings({ capacity: 0 }),
      settings({ capacity: 11 }),
      settings({ topics: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      settings({ introduction: 'x'.repeat(501) }),
    ]) {
      expect((await as(staff).put('/api/mentors/me', bad)).status).toBe(422)
    }
    expect(await db().mentorProfile.count()).toBe(0)
  })

  it('refuses a capacity below the active mentorships; availability off keeps relationships', async () => {
    const mentor = await createMentor()
    const [first, second] = [await createMember(t), await createMember(t)]
    await activeMentorship(first, mentor)
    const secondMentorship = await activeMentorship(second, mentor)

    const lowered = await as(mentor).put('/api/mentors/me', settings({ capacity: 1 }))
    expect(lowered.status).toBe(409)
    expect(lowered.body.error.code).toBe('CAPACITY_EXCEEDED')
    expect((await db().mentorProfile.findUniqueOrThrow({ where: { memberId: mentor.id } })).capacity).toBe(2)

    const off = await as(mentor).put('/api/mentors/me', settings({ available: false, capacity: 2 }))
    expect(off.status).toBe(200)
    expect(await state(secondMentorship.id)).toBe('ACTIVE')
    await as(second).post(`/api/mentorships/${secondMentorship.id}/end`).expect(204)
    expect((await as(mentor).put('/api/mentors/me', settings({ capacity: 1 }))).status).toBe(200)
  })
})

describe('Mentorship Board and mentor profile', () => {
  it('lists available, eligible mentors and searches introduction and topics, never contacts', async () => {
    const student = await createMember(t)
    const backend = await createMentor({
      displayName: 'Meseret',
      settings: { topics: ['Backend APIs'], introduction: 'Databases and APIs' },
    })
    const design = await createMentor({
      role: 'ALUMNI',
      displayName: 'Yonas',
      settings: { topics: ['UI Design'], introduction: 'Product design', capacity: 1 },
    })
    await createMentor({ displayName: 'Away', settings: { available: false } })
    const flagged = await createMentor({ role: 'ALUMNI', displayName: 'Flagged' })
    await db().memberAccount.update({ where: { id: flagged.id }, data: { alumniStatus: 'FLAGGED' } })
    const disabled = await createMentor({ displayName: 'Disabled' })
    await db().memberAccount.update({ where: { id: disabled.id }, data: { state: 'DISABLED' } })

    const board = await as(student).get('/api/boards/mentorship')
    expect(board.status).toBe(200)
    expect(board.body.total).toBe(2)
    expect(new Set(mentorIds(board.body))).toEqual(new Set([backend.id, design.id]))
    expect(JSON.stringify(board.body)).not.toContain('@mentor')

    const byText = await as(student).get('/api/boards/mentorship?text=databases')
    expect(mentorIds(byText.body)).toEqual([backend.id])
    const byTopic = await as(student).get('/api/boards/mentorship?topic=ui%20design')
    expect(mentorIds(byTopic.body)).toEqual([design.id])
    const byTag = await as(student).get('/api/boards/mentorship?tag=%23backend-apis')
    expect(mentorIds(byTag.body)).toEqual([backend.id])

    await activeMentorship(student, design, 'UI Design')
    const open = await as(student).get('/api/boards/mentorship?openOnly=true')
    expect(mentorIds(open.body)).toEqual([backend.id])
    const paged = await as(student).get('/api/boards/mentorship?pageSize=1&page=3')
    expect(paged.body).toMatchObject({ items: [], total: 2 })
    expect((await as(student).get('/api/boards/jobs')).status).toBe(404)
  })

  it('shows a profile with the reason a request is blocked; ineligible mentors are not found', async () => {
    const student = await createMember(t)
    const mentor = await createMentor({ settings: { capacity: 1 } })
    const profile = await as(student).get(`/api/mentors/${mentor.id}`)
    expect(profile.status).toBe(200)
    expect(profile.body).toMatchObject({
      mentor: { memberId: mentor.id, displayName: 'Meseret' },
      capacity: 1,
      activeCount: 0,
      requestBlock: null,
      viewerMentorship: null,
      viewerActiveMentors: 0,
    })
    expect(profile.body).not.toHaveProperty('contacts')

    const request = await requestMentor(student, mentor)
    expect((await as(student).get(`/api/mentors/${mentor.id}`)).body).toMatchObject({
      requestBlock: 'OPEN_MENTORSHIP',
      viewerMentorship: { id: request.id, state: 'PENDING' },
    })
    const other = await createMember(t)
    await as(mentor).post(`/api/mentorships/${request.id}/acceptance`).expect(200)
    expect((await as(other).get(`/api/mentors/${mentor.id}`)).body.requestBlock).toBe('MENTOR_FULL')
    expect((await as(mentor).get(`/api/mentors/${mentor.id}`)).body.requestBlock).toBe('NOT_STUDENT')

    await as(mentor)
      .put('/api/mentors/me', settings({ capacity: 1, available: false }))
      .expect(200)
    expect((await as(other).get(`/api/mentors/${mentor.id}`)).body.requestBlock).toBe('UNAVAILABLE')

    await db().memberAccount.update({ where: { id: mentor.id }, data: { state: 'DISABLED' } })
    expect((await as(other).get(`/api/mentors/${mentor.id}`)).status).toBe(404)
    expect((await as(other).get(`/api/mentors/${randomUUID()}`)).status).toBe(404)
    expect((await as(other).get('/api/mentors/not-a-uuid')).status).toBe(404)
  })

  it('global search returns mentors beside posts, and a category limits it', async () => {
    const student = await createMember(t)
    const mentor = await createMentor({ settings: { topics: ['Cloud'], introduction: 'Kubernetes' } })
    await as(student)
      .post('/api/posts', { body: 'Kubernetes study group', tags: ['cloud'] })
      .expect(201)

    const both = await as(student).get('/api/search?text=kubernetes')
    expect(both.status).toBe(200)
    expect(both.body.posts.total).toBe(1)
    expect(mentorIds(both.body.mentors)).toEqual([mentor.id])
    const tag = await as(student).get('/api/search?tag=cloud')
    expect(mentorIds(tag.body.mentors)).toEqual([mentor.id])
    const onlyMentors = await as(student).get('/api/search?text=kubernetes&category=MENTORS')
    expect(onlyMentors.body.posts).toBeNull()
    expect(onlyMentors.body.mentors.total).toBe(1)
  })
})

describe('Request or Withdraw Mentorship', () => {
  it('creates a pending request and notifies the mentor; a second open request is a duplicate', async () => {
    const student = await createMember(t, { displayName: 'Selam' })
    const mentor = await createMentor()
    const request = await requestMentor(student, mentor, 'backend apis')
    expect(request).toMatchObject({
      state: 'PENDING',
      topic: 'Backend APIs',
      viewerSide: 'STUDENT',
      student: { memberId: student.id, displayName: 'Selam' },
      mentor: { memberId: mentor.id },
      decidedAt: null,
    })
    expect(await notices(mentor.id)).toEqual([
      {
        type: 'MENTORSHIP_REQUEST',
        eventKey: `mentorship:${request.id}:requested`,
        actorId: student.id,
        targetType: 'MENTORSHIP',
        targetId: request.id,
      },
    ])
    const again = await as(student).post(`/api/mentors/${mentor.id}/mentorships`, {
      topic: 'Career advice',
      note: 'Hi',
    })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('DUPLICATE')
  })

  it('enforces eligibility, availability, the topic list and both limits', async () => {
    const student = await createMember(t)
    const mentor = await createMentor({ settings: { capacity: 1 } })
    const body = { topic: 'Backend APIs', note: 'Hello' }

    const staff = await createMember(t, { role: 'STAFF' })
    expect((await as(staff).post(`/api/mentors/${mentor.id}/mentorships`, body)).status).toBe(403)
    const unknownTopic = await as(student).post(`/api/mentors/${mentor.id}/mentorships`, {
      ...body,
      topic: 'Cooking',
    })
    expect(unknownTopic.status).toBe(422)
    expect(unknownTopic.body.error.fields).toHaveProperty('topic')
    expect(
      (await as(student).post(`/api/mentors/${mentor.id}/mentorships`, { topic: 'AI', note: ' ' })).status,
    ).toBe(422)
    expect((await as(student).post(`/api/mentors/${randomUUID()}/mentorships`, body)).status).toBe(404)

    const away = await createMentor({ settings: { available: false } })
    expect((await as(student).post(`/api/mentors/${away.id}/mentorships`, body)).status).toBe(403)
    const flagged = await createMentor({ role: 'ALUMNI' })
    await db().memberAccount.update({ where: { id: flagged.id }, data: { alumniStatus: 'FLAGGED' } })
    expect((await as(student).post(`/api/mentors/${flagged.id}/mentorships`, body)).status).toBe(404)

    await activeMentorship(await createMember(t), mentor)
    const full = await as(student).post(`/api/mentors/${mentor.id}/mentorships`, body)
    expect(full.status).toBe(409)
    expect(full.body.error.code).toBe('CAPACITY_EXCEEDED')

    for (let index = 0; index < 3; index += 1) await activeMentorship(student, await createMentor())
    const limit = await as(student).post(`/api/mentors/${(await createMentor()).id}/mentorships`, body)
    expect(limit.status).toBe(409)
    expect(limit.body.error.code).toBe('CAPACITY_EXCEEDED')
    expect(await db().mentorship.count({ where: { studentId: student.id, state: 'PENDING' } })).toBe(0)
  })

  it('lets only the Student withdraw a pending request; the mentor is notified', async () => {
    const student = await createMember(t)
    const mentor = await createMentor()
    const request = await requestMentor(student, mentor)
    expect((await as(mentor).post(`/api/mentorships/${request.id}/withdrawal`)).status).toBe(403)
    expect((await as(await createMember(t)).post(`/api/mentorships/${request.id}/withdrawal`)).status).toBe(
      404,
    )
    await as(student).post(`/api/mentorships/${request.id}/withdrawal`).expect(204)
    expect(await state(request.id)).toBe('WITHDRAWN')
    expect((await notices(mentor.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${request.id}:WITHDRAWN`,
    )
    expect((await as(student).post(`/api/mentorships/${request.id}/withdrawal`)).status).toBe(409)
    // A closed request frees the pair for a new one.
    await requestMentor(student, mentor)
  })
})

describe('Respond to Mentorship Request and End Mentorship', () => {
  it('accepts, shows contacts to the active mentee only and ends from either side', async () => {
    const student = await createMember(t)
    const mentor = await createMentor()
    const request = await requestMentor(student, mentor)
    expect((await as(student).get(`/api/mentors/${mentor.id}/contacts`)).status).toBe(403)
    expect((await as(student).post(`/api/mentorships/${request.id}/acceptance`)).status).toBe(403)

    const accepted = await as(mentor).post(`/api/mentorships/${request.id}/acceptance`)
    expect(accepted.status).toBe(200)
    expect(accepted.body).toMatchObject({
      state: 'ACTIVE',
      viewerSide: 'MENTOR',
      decidedAt: NOW.toISOString(),
    })
    expect((await notices(student.id)).map((notice) => notice.eventKey)).toEqual([
      `mentorship:${request.id}:ACTIVE`,
    ])
    const contacts = await as(student).get(`/api/mentors/${mentor.id}/contacts`)
    expect(contacts.status).toBe(200)
    expect(contacts.body).toEqual([{ kind: 'TELEGRAM', value: '@mentor' }])
    expect((await as(await createMember(t)).get(`/api/mentors/${mentor.id}/contacts`)).status).toBe(403)

    expect((await as(mentor).post(`/api/mentorships/${request.id}/acceptance`)).status).toBe(409)
    expect((await as(mentor).post(`/api/mentorships/${request.id}/decline`)).status).toBe(409)
    expect((await as(student).post(`/api/mentorships/${request.id}/withdrawal`)).status).toBe(409)

    await as(mentor).post(`/api/mentorships/${request.id}/end`).expect(204)
    expect(await state(request.id)).toBe('ENDED')
    expect((await notices(student.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${request.id}:ENDED`,
    )
    expect((await as(student).get(`/api/mentors/${mentor.id}/contacts`)).status).toBe(403)
    expect((await as(student).post(`/api/mentorships/${request.id}/end`)).status).toBe(409)
  })

  it('withholds contacts while the mentor is Flagged or Disabled, keeping the relationship', async () => {
    const student = await createMember(t)
    const mentor = await createMentor({ role: 'ALUMNI' })
    const request = await activeMentorship(student, mentor)
    await db().memberAccount.update({ where: { id: mentor.id }, data: { alumniStatus: 'FLAGGED' } })
    expect((await as(student).get(`/api/mentors/${mentor.id}/contacts`)).status).toBe(403)
    await db().memberAccount.update({
      where: { id: mentor.id },
      data: { alumniStatus: 'VERIFIED', state: 'DISABLED' },
    })
    expect((await as(student).get(`/api/mentors/${mentor.id}/contacts`)).status).toBe(403)
    expect(await state(request.id)).toBe('ACTIVE')
    // The other participant may still end it.
    await as(student).post(`/api/mentorships/${request.id}/end`).expect(204)
  })

  it('declines with a notice; acceptance works while unavailable and rechecks the Student', async () => {
    const student = await createMember(t)
    const mentor = await createMentor()
    const declined = await requestMentor(student, mentor)
    await as(mentor).post(`/api/mentorships/${declined.id}/decline`).expect(204)
    const row = await db().mentorship.findUniqueOrThrow({ where: { id: declined.id } })
    expect(row).toMatchObject({ state: 'DECLINED', decidedAt: NOW })
    expect((await notices(student.id)).map((notice) => notice.eventKey)).toEqual([
      `mentorship:${declined.id}:DECLINED`,
    ])

    const pending = await requestMentor(student, mentor)
    const other = await requestMentor(await createMember(t), mentor)
    await as(mentor)
      .put('/api/mentors/me', settings({ available: false }))
      .expect(200)
    await as(mentor).post(`/api/mentorships/${pending.id}/acceptance`).expect(200)

    await db().memberAccount.update({ where: { id: other.student.memberId! }, data: { state: 'DISABLED' } })
    const list = await as(mentor).get('/api/mentorships?side=MENTOR&state=PENDING')
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: other.id, acceptBlock: 'STUDENT_INELIGIBLE' }),
    ])
    expect((await as(mentor).post(`/api/mentorships/${other.id}/acceptance`)).status).toBe(409)
  })

  it('never exceeds the mentor capacity or the limit of three under parallel acceptances', async () => {
    const mentor = await createMentor({ settings: { capacity: 2 } })
    const students = await Promise.all([1, 2, 3, 4].map(() => createMember(t)))
    const requests: MentorshipView[] = []
    for (const student of students) requests.push(await requestMentor(student, mentor))
    const results = await Promise.all(
      requests.map((request) => as(mentor).post(`/api/mentorships/${request.id}/acceptance`)),
    )
    expect(results.map((result) => result.status).sort()).toEqual([200, 200, 409, 409])
    expect(await db().mentorship.count({ where: { mentorId: mentor.id, state: 'ACTIVE' } })).toBe(2)

    const student = await createMember(t)
    for (let index = 0; index < 2; index += 1) await activeMentorship(student, await createMentor())
    const mentors = await Promise.all([1, 2, 3].map(() => createMentor()))
    const pending: MentorshipView[] = []
    for (const each of mentors) pending.push(await requestMentor(student, each))
    const accepted = await Promise.all(
      pending.map((request, index) => as(mentors[index]!).post(`/api/mentorships/${request.id}/acceptance`)),
    )
    expect(accepted.map((result) => result.status).sort()).toEqual([200, 409, 409])
    expect(await db().mentorship.count({ where: { studentId: student.id, state: 'ACTIVE' } })).toBe(3)
  })

  it('lists the actor’s mentorships by side and state, newest change first', async () => {
    const student = await createMember(t)
    const mentorA = await createMentor()
    const mentorB = await createMentor()
    const first = await activeMentorship(student, mentorA)
    t.clock.advance(60_000)
    const second = await requestMentor(student, mentorB)

    const all = await as(student).get('/api/mentorships')
    expect(all.status).toBe(200)
    expect(all.body.items.map((item: MentorshipView) => item.id)).toEqual([second.id, first.id])
    const active = await as(student).get('/api/mentorships?side=STUDENT&state=ACTIVE')
    expect(active.body.items).toEqual([expect.objectContaining({ id: first.id, studentActiveMentors: 1 })])
    const history = await as(student).get('/api/mentorships?state=DECLINED,WITHDRAWN,ENDED')
    expect(history.body.total).toBe(0)
    expect((await as(mentorA).get('/api/mentorships?side=STUDENT')).body.total).toBe(0)
    expect((await as(student).get('/api/mentorships?state=OPEN')).status).toBe(422)
    expect((await as(mentorB).get(`/api/mentorships/${second.id}`)).body.acceptBlock).toBeNull()
    expect((await as(mentorA).get(`/api/mentorships/${second.id}`)).status).toBe(404)
  })
})

describe('Lifecycle', () => {
  it('graduation ends mentee relationships and withdraws pending requests, notifying the mentors', async () => {
    const admin = await createAdmin(t)
    const student = await createMember(t)
    const mentorA = await createMentor({ settings: { capacity: 1 } })
    const mentorB = await createMentor()
    const active = await activeMentorship(student, mentorA)
    const pending = await requestMentor(student, mentorB)
    const request = await db().graduationRequest.create({
      data: { memberId: student.id, programme: 'SOFTWARE_ENGINEERING', graduationYear: 2026 },
    })
    await api(t, admin.token)
      .post(`/api/admin/graduation-requests/${request.id}/decision`, {
        decision: 'CONFIRMED',
        reason: 'Checked with the registrar',
      })
      .expect(204)
    expect(await state(active.id)).toBe('ENDED')
    expect(await state(pending.id)).toBe('WITHDRAWN')
    expect((await notices(mentorA.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${active.id}:ENDED`,
    )
    expect((await notices(mentorB.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${pending.id}:WITHDRAWN`,
    )
    // The place is released.
    expect((await as(await createMember(t)).get(`/api/mentors/${mentorA.id}`)).body.activeCount).toBe(0)
  })

  it('refuses a role correction while mentorships are pending or active', async () => {
    const admin = await createAdmin(t)
    const student = await createMember(t)
    const mentor = await createMentor()
    const request = await requestMentor(student, mentor)
    const reason = 'Corrected after checking records'
    const refused = await api(t, admin.token).put(`/api/admin/members/${mentor.id}/role`, {
      newRole: 'STUDENT',
      reason,
    })
    expect(refused.status).toBe(409)
    expect(
      (await api(t, admin.token).put(`/api/admin/members/${student.id}/role`, { newRole: 'STAFF', reason }))
        .status,
    ).toBe(409)
    expect((await db().memberAccount.findUniqueOrThrow({ where: { id: mentor.id } })).role).toBe('STAFF')

    await as(student).post(`/api/mentorships/${request.id}/withdrawal`).expect(204)
    await api(t, admin.token)
      .put(`/api/admin/members/${mentor.id}/role`, { newRole: 'STUDENT', reason })
      .expect(204)
    // The kept profile is hidden while the member cannot mentor.
    expect((await as(student).get(`/api/mentors/${mentor.id}`)).status).toBe(404)
    expect((await as(student).get('/api/boards/mentorship')).body.total).toBe(0)
  })

  it('deleting a mentor ends and withdraws both sides and removes the profile and contacts', async () => {
    const mentor = await createMentor()
    const mentee = await createMember(t)
    const asker = await createMember(t)
    const active = await activeMentorship(mentee, mentor)
    const pending = await requestMentor(asker, mentor)

    await as(mentor).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect(await state(active.id)).toBe('ENDED')
    expect(await state(pending.id)).toBe('WITHDRAWN')
    expect((await notices(mentee.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${active.id}:ENDED`,
    )
    expect((await notices(asker.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${pending.id}:WITHDRAWN`,
    )
    expect(await db().mentorProfile.count({ where: { memberId: mentor.id } })).toBe(0)
    expect(await db().mentorContact.count({ where: { mentorId: mentor.id } })).toBe(0)
    const history = await as(mentee).get('/api/mentorships')
    expect(history.body.items[0].mentor).toMatchObject({ deleted: true, memberId: null })
  })

  it('deleting a Student ends their mentorships and notifies the mentor', async () => {
    const mentor = await createMentor()
    const student = await createMember(t)
    const active = await activeMentorship(student, mentor)
    await as(student).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect(await state(active.id)).toBe('ENDED')
    expect((await notices(mentor.id)).map((notice) => notice.eventKey)).toContain(
      `mentorship:${active.id}:ENDED`,
    )
  })
})
