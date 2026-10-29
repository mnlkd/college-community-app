import { randomUUID } from 'node:crypto'
import type { OpportunityView, Page } from '@hilcoe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, PASSWORD, type TestMember } from '../helpers/members.js'
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
const as = (member: TestMember) => api(t, member.token)
const ids = (page: Page<OpportunityView>) => page.items.map((item) => item.id)

const listing = (overrides: object = {}) => ({
  title: 'Backend Intern',
  organization: 'Kifiya',
  location: 'Addis Ababa',
  type: 'INTERNSHIP',
  workArrangement: 'HYBRID',
  description: 'Build payment APIs with our platform team.',
  applyVia: 'careers@kifiya.example',
  deadline: '2026-11-15',
  ...overrides,
})

async function post(author: TestMember, overrides: object = {}): Promise<OpportunityView> {
  const response = await as(author).post('/api/opportunities', listing(overrides))
  expect(response.status).toBe(201)
  return response.body as OpportunityView
}

async function restrict(member: TestMember) {
  const violation = await db().violation.create({
    data: { memberId: member.id, targetType: 'POST', targetId: randomUUID(), decisionAt: NOW },
  })
  await db().consequence.create({
    data: {
      memberId: member.id,
      violationId: violation.id,
      kind: 'RESTRICTION',
      restrictUntil: new Date(NOW.getTime() + 14 * 86_400_000),
    },
  })
}

describe('Manage Opportunity Listing', () => {
  it('lets Staff and Verified Alumni post a trimmed listing with a calendar-date deadline', async () => {
    const staff = await createMember(t, { role: 'STAFF', displayName: 'Meseret' })
    const created = await post(staff, { title: '  Backend Intern  ' })
    expect(created).toMatchObject({
      title: 'Backend Intern',
      type: 'INTERNSHIP',
      state: 'OPEN',
      isOwn: true,
      savedByMe: false,
      details: {
        author: { displayName: 'Meseret' },
        organization: 'Kifiya',
        workArrangement: 'HYBRID',
        deadline: '2026-11-15',
        version: 1,
        saveCount: 0,
      },
    })
    const alumni = await createMember(t, { role: 'ALUMNI' })
    const open = await post(alumni, { deadline: '' })
    expect(open.details?.deadline).toBeNull()
    const reader = await createMember(t)
    expect((await as(reader).get(`/api/opportunities/${created.id}`)).body).toMatchObject({ isOwn: false })
  })

  it('refuses Students, unverified Alumni, invalid input and restricted authors', async () => {
    for (const member of [
      await createMember(t),
      await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' }),
      await createMember(t, { role: 'ALUMNI', alumniStatus: 'FLAGGED' }),
    ]) {
      expect((await as(member).post('/api/opportunities', listing())).status).toBe(403)
    }
    const staff = await createMember(t, { role: 'STAFF' })
    const invalid = await as(staff).post(
      '/api/opportunities',
      listing({ title: '   ', type: 'GIG', deadline: '15/11/2026', description: 'x'.repeat(10_001) }),
    )
    expect(invalid.status).toBe(422)
    expect(Object.keys(invalid.body.error.fields).sort()).toEqual([
      'deadline',
      'description',
      'title',
      'type',
    ])

    const own = await post(staff)
    await restrict(staff)
    expect((await as(staff).post('/api/opportunities', listing())).body.error.code).toBe('RESTRICTED')
    const edit = await as(staff).put(`/api/opportunities/${own.id}`, listing({ version: 1 }))
    expect(edit.body.error.code).toBe('RESTRICTED')
    // Closing stays allowed during a restriction.
    expect((await as(staff).post(`/api/opportunities/${own.id}/closure`)).status).toBe(204)
    expect(await db().opportunity.count()).toBe(1)
  })

  it('edits with the version read; another member or a stale version is refused', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const created = await post(staff)
    const edited = await as(staff).put(
      `/api/opportunities/${created.id}`,
      listing({ title: 'Platform Intern', workArrangement: 'REMOTE', deadline: null, version: 1 }),
    )
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({
      title: 'Platform Intern',
      details: { workArrangement: 'REMOTE', deadline: null, version: 2 },
    })
    const stale = await as(staff).put(`/api/opportunities/${created.id}`, listing({ version: 1 }))
    expect(stale.status).toBe(409)
    const other = await createMember(t, { role: 'STAFF' })
    expect((await as(other).put(`/api/opportunities/${created.id}`, listing({ version: 2 }))).status).toBe(
      403,
    )
    expect((await as(other).post(`/api/opportunities/${created.id}/closure`)).status).toBe(403)
    expect((await as(staff).get(`/api/opportunities/${randomUUID()}`)).status).toBe(404)
  })

  it('closes finally: a closed listing shows only title, type and status, to its author too', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const created = await post(staff)
    const saver = await createMember(t)
    await as(saver).put(`/api/saved-items/opportunities/${created.id}`).expect(204)
    await as(staff).post(`/api/opportunities/${created.id}/closure`).expect(204)

    for (const viewer of [staff, saver]) {
      const view = await as(viewer).get(`/api/opportunities/${created.id}`)
      expect(view.body).toMatchObject({
        title: 'Backend Intern',
        type: 'INTERNSHIP',
        state: 'CLOSED',
        details: null,
      })
    }
    expect((await as(staff).post(`/api/opportunities/${created.id}/closure`)).status).toBe(409)
    expect((await as(staff).put(`/api/opportunities/${created.id}`, listing({ version: 2 }))).status).toBe(
      409,
    )
    // The board drops it; saved items keep it with its state; it cannot be saved again.
    expect((await as(saver).get('/api/boards/opportunities')).body.total).toBe(0)
    const saved = await as(saver).get('/api/saved-items')
    expect(saved.body.items[0]).toMatchObject({
      targetType: 'OPPORTUNITY',
      state: 'CLOSED',
      opportunity: { state: 'CLOSED', details: null },
    })
    const other = await createMember(t)
    expect((await as(other).put(`/api/saved-items/opportunities/${created.id}`)).status).toBe(409)
    expect((await as(saver).delete(`/api/saved-items/opportunities/${created.id}`)).status).toBe(204)
  })
})

describe('Opportunities Board and search', () => {
  it('lists open listings by type, arrangement, text and #tag word; "mine" lists every state', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const alumni = await createMember(t, { role: 'ALUMNI' })
    const intern = await post(staff)
    t.clock.advance(60_000)
    const remote = await post(alumni, {
      title: 'Data Analyst',
      type: 'FULL_TIME',
      workArrangement: 'REMOTE',
      description: 'Python and SQL reporting for fintech.',
    })
    t.clock.advance(60_000)
    const closed = await post(staff, { title: 'Closed role', type: 'PART_TIME' })
    await as(staff).post(`/api/opportunities/${closed.id}/closure`).expect(204)

    const student = await createMember(t)
    const board = async (query = '') => (await as(student).get(`/api/boards/opportunities${query}`)).body
    expect(ids(await board())).toEqual([remote.id, intern.id])
    expect(ids(await board('?type=FULL_TIME'))).toEqual([remote.id])
    expect(ids(await board('?workArrangement=HYBRID'))).toEqual([intern.id])
    expect(ids(await board('?text=payment'))).toEqual([intern.id])
    expect(ids(await board('?tag=%23fintech'))).toEqual([remote.id])
    expect(ids(await board('?tag=fin'))).toEqual([])
    expect((await as(student).get('/api/boards/opportunities?type=GIG')).status).toBe(422)

    const mine = await as(staff).get('/api/boards/opportunities?mine=true')
    expect(ids(mine.body)).toEqual([intern.id, closed.id])
    expect(mine.body.items[1]).toMatchObject({ state: 'CLOSED', details: null })

    const search = await as(student).get('/api/search?text=python')
    expect(ids(search.body.opportunities)).toEqual([remote.id])
    expect(search.body.groups).toMatchObject({ total: 0 })
    const only = await as(student).get('/api/search?text=python&category=OPPORTUNITIES')
    expect(only.body).toMatchObject({ posts: null, groups: null, mentors: null })
  })

  it('counts saves on the listing; savedByMe is private', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const created = await post(staff)
    const saver = await createMember(t)
    await as(saver).put(`/api/saved-items/opportunities/${created.id}`).expect(204)
    expect((await as(saver).get(`/api/opportunities/${created.id}`)).body).toMatchObject({
      savedByMe: true,
      details: { saveCount: 1 },
    })
    expect((await as(staff).get(`/api/opportunities/${created.id}`)).body).toMatchObject({
      savedByMe: false,
      details: { saveCount: 1 },
    })
    const selfReported = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    expect((await as(selfReported).put(`/api/saved-items/opportunities/${created.id}`)).status).toBe(403)
  })
})

describe('Lifecycle', () => {
  it('refuses a role correction while the author has open listings', async () => {
    const admin = await createAdmin(t)
    const staff = await createMember(t, { role: 'STAFF' })
    const created = await post(staff)
    const reason = 'Corrected after checking records'
    const refused = await api(t, admin.token).put(`/api/admin/members/${staff.id}/role`, {
      newRole: 'STUDENT',
      reason,
    })
    expect(refused.status).toBe(409)
    await as(staff).post(`/api/opportunities/${created.id}/closure`).expect(204)
    await api(t, admin.token)
      .put(`/api/admin/members/${staff.id}/role`, { newRole: 'STUDENT', reason })
      .expect(204)
  })

  it('closes the listings of a deleted author', async () => {
    const staff = await createMember(t, { role: 'STAFF' })
    const created = await post(staff)
    await as(staff).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect((await db().opportunity.findUniqueOrThrow({ where: { id: created.id } })).state).toBe('CLOSED')
  })
})
