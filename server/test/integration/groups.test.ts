import { randomUUID } from 'node:crypto'
import type { GroupSummaryView, GroupTransferView, GroupView, MembershipView, Page } from '@hilcoe/shared'
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
const ids = (page: Page<GroupSummaryView>) => page.items.map((item) => item.id)

const groupInput = (overrides: object = {}) => ({
  title: 'Algorithms study circle',
  description: 'Weekly practice for the data structures exam. Saturdays 10:00.',
  maxOccupancy: 3,
  coordinationDetails: 'Library room 2, Telegram @algo_circle',
  ...overrides,
})

async function createGroup(owner: TestMember, overrides: object = {}): Promise<GroupView> {
  const response = await as(owner).post('/api/groups', groupInput(overrides))
  expect(response.status).toBe(201)
  return response.body as GroupView
}

async function requestJoin(member: TestMember, group: GroupView): Promise<MembershipView> {
  const response = await as(member).post(`/api/groups/${group.id}/memberships`)
  expect(response.status).toBe(201)
  return response.body as MembershipView
}

async function join(owner: TestMember, member: TestMember, group: GroupView): Promise<MembershipView> {
  const request = await requestJoin(member, group)
  await as(owner).post(`/api/group-memberships/${request.id}/approval`).expect(204)
  return request
}

async function propose(owner: TestMember, to: TestMember, group: GroupView): Promise<GroupTransferView> {
  const response = await as(owner).post(`/api/groups/${group.id}/transfers`, { memberId: to.id })
  expect(response.status).toBe(201)
  return response.body as GroupTransferView
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

const notices = async (recipientId: string) =>
  (
    await db().notification.findMany({
      where: { recipientId },
      select: { eventKey: true },
      orderBy: { createdAt: 'asc' },
    })
  ).map((notice) => notice.eventKey)
const membershipState = async (id: string) =>
  (await db().groupMembership.findUniqueOrThrow({ where: { id } })).state

describe('Create or Close Group', () => {
  it('lets a Student create a group they own and occupy', async () => {
    const owner = await createMember(t, { displayName: 'Selamawit' })
    const group = await createGroup(owner, { title: '  Algorithms study circle ' })
    expect(group).toMatchObject({
      title: 'Algorithms study circle',
      owner: { displayName: 'Selamawit' },
      maxOccupancy: 3,
      occupancy: 1,
      state: 'OPEN',
      version: 1,
      viewerRelation: 'OWNER',
      joinBlock: null,
      pendingCount: 0,
      coordinationDetails: 'Library room 2, Telegram @algo_circle',
      coordinationWithheld: false,
      pendingTransfer: null,
    })
    expect(group.members).toEqual([expect.objectContaining({ isOwner: true })])
  })

  it('refuses non-Students, invalid input and restricted owners', async () => {
    for (const role of ['STAFF', 'ALUMNI'] as const) {
      const member = await createMember(t, { role })
      expect((await as(member).post('/api/groups', groupInput())).status).toBe(403)
    }
    const student = await createMember(t)
    const invalid = await as(student).post('/api/groups', groupInput({ title: ' ', maxOccupancy: 101 }))
    expect(invalid.status).toBe(422)
    expect(Object.keys(invalid.body.error.fields).sort()).toEqual(['maxOccupancy', 'title'])
    expect((await as(student).post('/api/groups', groupInput({ maxOccupancy: 0 }))).status).toBe(422)

    const group = await createGroup(student)
    await restrict(student)
    expect((await as(student).post('/api/groups', groupInput())).body.error.code).toBe('RESTRICTED')
    const edit = await as(student).put(`/api/groups/${group.id}`, groupInput({ version: 1 }))
    expect(edit.body.error.code).toBe('RESTRICTED')
    // Closing stays allowed.
    await as(student).post(`/api/groups/${group.id}/closure`).expect(204)
  })

  it('edits with the version read and never below the current occupancy', async () => {
    const owner = await createMember(t)
    const group = await createGroup(owner)
    await join(owner, await createMember(t), group)
    const lowered = await as(owner).put(
      `/api/groups/${group.id}`,
      groupInput({ maxOccupancy: 1, version: 1 }),
    )
    expect(lowered.status).toBe(409)
    expect(lowered.body.error.code).toBe('CAPACITY_EXCEEDED')
    const edited = await as(owner).put(
      `/api/groups/${group.id}`,
      groupInput({ maxOccupancy: 2, coordinationDetails: null, version: 1 }),
    )
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({ maxOccupancy: 2, version: 2, coordinationDetails: null })
    expect((await as(owner).put(`/api/groups/${group.id}`, groupInput({ version: 1 }))).status).toBe(409)
    const stranger = await createMember(t)
    expect((await as(stranger).put(`/api/groups/${group.id}`, groupInput({ version: 2 }))).status).toBe(403)
    expect((await as(stranger).post(`/api/groups/${group.id}/closure`)).status).toBe(403)
  })

  it('closes finally: pending requests are declined and every party is notified', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const asker = await createMember(t)
    const group = await createGroup(owner)
    const accepted = await join(owner, member, group)
    const pending = await requestJoin(asker, group)
    const transfer = await propose(owner, member, group)

    await as(owner).post(`/api/groups/${group.id}/closure`).expect(204)
    expect(await membershipState(pending.id)).toBe('DECLINED')
    expect(await membershipState(accepted.id)).toBe('ACCEPTED')
    expect((await db().groupTransfer.findUniqueOrThrow({ where: { id: transfer.id } })).state).toBe(
      'CANCELLED',
    )
    expect(await notices(asker.id)).toContain(`group-membership:${pending.id}:DECLINED`)
    expect(await notices(member.id)).toEqual(
      expect.arrayContaining([`group-transfer:${transfer.id}:CANCELLED`, `group:${group.id}:CLOSED`]),
    )

    // Members keep the coordination details; joins and further changes are refused.
    const view = await as(member).get(`/api/groups/${group.id}`)
    expect(view.body).toMatchObject({
      state: 'CLOSED',
      coordinationDetails: groupInput().coordinationDetails,
    })
    const late = await createMember(t)
    expect((await as(late).get(`/api/groups/${group.id}`)).body.joinBlock).toBe('CLOSED')
    expect((await as(late).post(`/api/groups/${group.id}/memberships`)).status).toBe(409)
    expect((await as(owner).post(`/api/groups/${group.id}/closure`)).status).toBe(409)
    expect((await as(owner).put(`/api/groups/${group.id}`, groupInput({ version: 2 }))).status).toBe(409)
    expect((await as(late).get('/api/boards/activities')).body.total).toBe(0)
  })
})

describe('Manage Group Membership', () => {
  it('requests, approves and shows coordination details and members to accepted members only', async () => {
    const owner = await createMember(t)
    const student = await createMember(t)
    const group = await createGroup(owner)

    const outsider = await as(student).get(`/api/groups/${group.id}`)
    expect(outsider.body).toMatchObject({
      viewerRelation: null,
      joinBlock: null,
      coordinationDetails: null,
      coordinationWithheld: false,
      members: null,
      pendingCount: null,
    })
    const request = await requestJoin(student, group)
    expect(request).toMatchObject({ state: 'PENDING', groupId: group.id, joinedAt: null })
    expect(await notices(owner.id)).toEqual([`group-membership:${request.id}:requested`])
    expect((await as(student).post(`/api/groups/${group.id}/memberships`)).body.error.code).toBe('DUPLICATE')
    expect((await as(student).get(`/api/groups/${group.id}`)).body.viewerRelation).toBe('PENDING')

    const queue = await as(owner).get(`/api/groups/${group.id}/join-requests`)
    expect(queue.body.items).toEqual([expect.objectContaining({ id: request.id, approveBlock: null })])
    expect((await as(student).get(`/api/groups/${group.id}/join-requests`)).status).toBe(403)
    expect((await as(student).post(`/api/group-memberships/${request.id}/approval`)).status).toBe(403)
    const stranger = await createMember(t)
    expect((await as(stranger).post(`/api/group-memberships/${request.id}/approval`)).status).toBe(404)
    expect((await as(owner).get(`/api/groups/${group.id}`)).body.pendingCount).toBe(1)

    await as(owner).post(`/api/group-memberships/${request.id}/approval`).expect(204)
    expect(await notices(student.id)).toEqual([`group-membership:${request.id}:ACCEPTED`])
    expect((await as(owner).post(`/api/group-memberships/${request.id}/decline`)).status).toBe(409)
    const inside = await as(student).get(`/api/groups/${group.id}`)
    expect(inside.body).toMatchObject({
      viewerRelation: 'MEMBER',
      occupancy: 2,
      coordinationDetails: groupInput().coordinationDetails,
    })
    expect(inside.body.members).toHaveLength(2)
    expect((await as(student).post(`/api/groups/${group.id}/memberships`)).body.error.code).toBe('DUPLICATE')
  })

  it('refuses non-Students and full groups; declines notify; withdrawal deletes the request', async () => {
    const owner = await createMember(t)
    const group = await createGroup(owner, { maxOccupancy: 2 })
    const staff = await createMember(t, { role: 'STAFF' })
    expect((await as(staff).get(`/api/groups/${group.id}`)).body.joinBlock).toBe('NOT_STUDENT')
    expect((await as(staff).post(`/api/groups/${group.id}/memberships`)).status).toBe(403)

    const declined = await requestJoin(await createMember(t), group)
    await as(owner).post(`/api/group-memberships/${declined.id}/decline`).expect(204)
    expect(await membershipState(declined.id)).toBe('DECLINED')

    const withdrawing = await createMember(t)
    await requestJoin(withdrawing, group)
    await as(withdrawing).delete(`/api/groups/${group.id}/memberships/me`).expect(204)
    expect(await db().groupMembership.count({ where: { memberId: withdrawing.id } })).toBe(0)
    expect((await as(withdrawing).delete(`/api/groups/${group.id}/memberships/me`)).status).toBe(404)

    await join(owner, await createMember(t), group)
    const late = await createMember(t)
    expect((await as(late).get(`/api/groups/${group.id}`)).body.joinBlock).toBe('FULL')
    const full = await as(late).post(`/api/groups/${group.id}/memberships`)
    expect(full.body.error.code).toBe('CAPACITY_EXCEEDED')
  })

  it('never exceeds the maximum under parallel approvals', async () => {
    const owner = await createMember(t)
    const group = await createGroup(owner, { maxOccupancy: 2 })
    const students = await Promise.all([1, 2, 3].map(() => createMember(t)))
    const requests: MembershipView[] = []
    for (const student of students) requests.push(await requestJoin(student, group))
    const results = await Promise.all(
      requests.map((request) => as(owner).post(`/api/group-memberships/${request.id}/approval`)),
    )
    expect(results.map((result) => result.status).sort()).toEqual([204, 409, 409])
    expect(await db().groupMembership.count({ where: { groupId: group.id, state: 'ACCEPTED' } })).toBe(2)
    const queue = await as(owner).get(`/api/groups/${group.id}/join-requests`)
    expect(queue.body.items.map((item: MembershipView) => item.approveBlock)).toEqual(['FULL', 'FULL'])
  })

  it('lets a member leave and release the place; the owner cannot leave', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    const membership = await join(owner, member, group)
    expect((await as(owner).post(`/api/groups/${group.id}/departure`)).status).toBe(403)
    await as(member).post(`/api/groups/${group.id}/departure`).expect(204)
    expect(await membershipState(membership.id)).toBe('LEFT')
    expect(await notices(owner.id)).toContain(`group-membership:${membership.id}:LEFT`)
    expect((await as(member).get(`/api/groups/${group.id}`)).body).toMatchObject({
      viewerRelation: null,
      coordinationDetails: null,
      occupancy: 1,
    })
    expect((await as(member).post(`/api/groups/${group.id}/departure`)).status).toBe(409)
    // A member who left may ask again.
    await requestJoin(member, group)
  })
})

describe('Transfer Group Ownership', () => {
  it('proposes to an accepted Student member who accepts; the former owner may then leave', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    await join(owner, member, group)
    const outsider = await createMember(t)
    expect(
      (await as(owner).post(`/api/groups/${group.id}/transfers`, { memberId: outsider.id })).status,
    ).toBe(409)

    const transfer = await propose(owner, member, group)
    expect(transfer).toMatchObject({
      state: 'PENDING',
      viewerSide: 'OWNER',
      group: { id: group.id, occupancy: 2 },
    })
    expect(await notices(member.id)).toContain(`group-transfer:${transfer.id}:proposed`)
    expect((await as(owner).post(`/api/groups/${group.id}/transfers`, { memberId: member.id })).status).toBe(
      409,
    )
    expect((await as(member).get(`/api/groups/${group.id}`)).body.pendingTransfer).toMatchObject({
      id: transfer.id,
      viewerSide: 'RECIPIENT',
    })
    expect((await as(outsider).get(`/api/group-transfers/${transfer.id}`)).status).toBe(404)
    expect((await as(owner).post(`/api/group-transfers/${transfer.id}/acceptance`)).status).toBe(403)
    expect((await as(member).post(`/api/group-transfers/${transfer.id}/cancellation`)).status).toBe(403)

    await as(member).post(`/api/group-transfers/${transfer.id}/acceptance`).expect(204)
    expect(await notices(owner.id)).toContain(`group-transfer:${transfer.id}:ACCEPTED`)
    const now = await as(member).get(`/api/groups/${group.id}`)
    expect(now.body).toMatchObject({ viewerRelation: 'OWNER', version: 2, pendingTransfer: null })
    expect((await as(owner).get(`/api/groups/${group.id}`)).body.viewerRelation).toBe('MEMBER')
    await as(owner).post(`/api/groups/${group.id}/departure`).expect(204)
    expect((await as(member).post(`/api/group-transfers/${transfer.id}/decline`)).status).toBe(409)
  })

  it('declines and cancels with notices; leaving cancels a pending transfer to the leaver', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    await join(owner, member, group)
    const declined = await propose(owner, member, group)
    await as(member).post(`/api/group-transfers/${declined.id}/decline`).expect(204)
    expect(await notices(owner.id)).toContain(`group-transfer:${declined.id}:DECLINED`)

    const cancelled = await propose(owner, member, group)
    await as(owner).post(`/api/group-transfers/${cancelled.id}/cancellation`).expect(204)
    expect(await notices(member.id)).toContain(`group-transfer:${cancelled.id}:CANCELLED`)

    const dropped = await propose(owner, member, group)
    await as(member).post(`/api/groups/${group.id}/departure`).expect(204)
    expect((await db().groupTransfer.findUniqueOrThrow({ where: { id: dropped.id } })).state).toBe(
      'CANCELLED',
    )
  })
})

describe('Activities Board, My groups and saves', () => {
  it('lists open groups by text and #tag word; My groups lists every relation', async () => {
    const owner = await createMember(t)
    const other = await createMember(t)
    const algorithms = await createGroup(owner)
    t.clock.advance(60_000)
    const football = await createGroup(other, {
      title: 'Friday football',
      description: 'Five-a-side after classes. Bring water.',
    })
    t.clock.advance(60_000)
    const closed = await createGroup(owner, { title: 'Old circle' })
    await as(owner).post(`/api/groups/${closed.id}/closure`).expect(204)

    const viewer = await createMember(t)
    const board = async (query = '') => (await as(viewer).get(`/api/boards/activities${query}`)).body
    expect(ids(await board())).toEqual([football.id, algorithms.id])
    expect(ids(await board('?text=football'))).toEqual([football.id])
    expect(ids(await board('?tag=%23exam'))).toEqual([algorithms.id])
    expect(ids((await as(viewer).get('/api/search?text=water')).body.groups)).toEqual([football.id])

    await requestJoin(owner, football)
    const mine = await as(owner).get('/api/groups/mine')
    expect(ids(mine.body)).toEqual([football.id, algorithms.id, closed.id])
    expect(mine.body.items.map((item: GroupSummaryView) => item.viewerRelation)).toEqual([
      'PENDING',
      'OWNER',
      'OWNER',
    ])
    expect(ids((await as(owner).get('/api/groups/mine?relation=OWNER&state=OPEN')).body)).toEqual([
      algorithms.id,
    ])
    expect((await as(owner).get('/api/groups/mine?relation=FRIEND')).status).toBe(422)
  })

  it('saves open groups only and keeps closed ones in saved items', async () => {
    const owner = await createMember(t)
    const group = await createGroup(owner)
    const saver = await createMember(t, { role: 'STAFF' })
    await as(saver).put(`/api/saved-items/groups/${group.id}`).expect(204)
    expect((await as(saver).get(`/api/groups/${group.id}`)).body.savedByMe).toBe(true)
    await as(owner).post(`/api/groups/${group.id}/closure`).expect(204)
    const saved = await as(saver).get('/api/saved-items')
    expect(saved.body.items[0]).toMatchObject({
      targetType: 'GROUP',
      state: 'CLOSED',
      group: { id: group.id },
    })
    expect((await as(await createMember(t)).put(`/api/saved-items/groups/${group.id}`)).status).toBe(409)
  })
})

describe('Lifecycle', () => {
  it('refuses graduation while the Student owns an open group and lists it as a blocker', async () => {
    const admin = await createAdmin(t)
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    const membership = await join(owner, member, group)
    const ownerRequest = await db().graduationRequest.create({
      data: { memberId: owner.id, programme: 'SOFTWARE_ENGINEERING', graduationYear: 2026 },
    })
    const listed = await api(t, admin.token).get('/api/admin/graduation-requests')
    expect(listed.body.items[0].blockers).toEqual([
      { kind: 'OWNED_GROUP', id: group.id, label: 'Algorithms study circle' },
    ])
    const decision = { decision: 'CONFIRMED', reason: 'Checked with the registrar' }
    const refused = await api(t, admin.token).post(
      `/api/admin/graduation-requests/${ownerRequest.id}/decision`,
      decision,
    )
    expect(refused.status).toBe(409)

    // A graduating member leaves the groups they joined; the owner is notified.
    const memberRequest = await db().graduationRequest.create({
      data: { memberId: member.id, programme: 'SOFTWARE_ENGINEERING', graduationYear: 2026 },
    })
    await api(t, admin.token)
      .post(`/api/admin/graduation-requests/${memberRequest.id}/decision`, decision)
      .expect(204)
    expect(await membershipState(membership.id)).toBe('LEFT')
    expect(await notices(owner.id)).toContain(`group-membership:${membership.id}:LEFT`)

    await as(owner).post(`/api/groups/${group.id}/closure`).expect(204)
    expect((await api(t, admin.token).get('/api/admin/graduation-requests')).body.items[0].blockers).toEqual(
      [],
    )
    await api(t, admin.token)
      .post(`/api/admin/graduation-requests/${ownerRequest.id}/decision`, decision)
      .expect(204)
  })

  it('deleting the owner closes the group and removes the coordination details', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const asker = await createMember(t)
    const group = await createGroup(owner)
    await join(owner, member, group)
    const pending = await requestJoin(asker, group)
    await as(owner).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)

    const row = await db().group.findUniqueOrThrow({ where: { id: group.id } })
    expect(row).toMatchObject({ state: 'CLOSED', coordinationDetails: null })
    expect(await membershipState(pending.id)).toBe('DECLINED')
    expect(await notices(member.id)).toContain(`group:${group.id}:CLOSED`)
    expect((await as(member).get(`/api/groups/${group.id}`)).body).toMatchObject({
      owner: { deleted: true },
      coordinationDetails: null,
    })
  })

  it('withholds coordination details while the owner is disabled', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    await join(owner, member, group)
    await db().memberAccount.update({ where: { id: owner.id }, data: { state: 'DISABLED' } })
    expect((await as(member).get(`/api/groups/${group.id}`)).body).toMatchObject({
      coordinationDetails: null,
      coordinationWithheld: true,
    })
  })

  it('deleting a member removes their requests and memberships', async () => {
    const owner = await createMember(t)
    const member = await createMember(t)
    const group = await createGroup(owner)
    const membership = await join(owner, member, group)
    const other = await createGroup(await createMember(t))
    await requestJoin(member, other)
    await as(member).delete('/api/members/me', { currentPassword: PASSWORD }).expect(204)
    expect(await membershipState(membership.id)).toBe('LEFT')
    expect(await db().groupMembership.count({ where: { groupId: other.id, state: 'PENDING' } })).toBe(0)
    expect((await as(owner).get(`/api/groups/${group.id}`)).body.occupancy).toBe(1)
  })
})
