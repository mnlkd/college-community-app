import { randomUUID } from 'node:crypto'
import type { NotificationInput } from '@hilcoe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp
let recipient: TestMember
let actor: TestMember

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  await resetDatabase(t.container.prisma)
  recipient = await createMember(t, { displayName: 'Recipient' })
  actor = await createMember(t, { displayName: 'Abel Tadesse' })
})

function notice(overrides: Partial<NotificationInput> = {}): NotificationInput {
  return {
    recipientId: recipient.id,
    type: 'COMMENT',
    eventKey: `comment:${randomUUID()}`,
    actorId: actor.id,
    targetType: 'POST',
    targetId: randomUUID(),
    ...overrides,
  }
}

const notify = (...inputs: NotificationInput[]) =>
  t.container.transactions.run(async (tx) => {
    for (const input of inputs) await t.container.notifications.notify(tx, input)
  })

describe('NotificationService.notify', () => {
  it('stores a notice that expires after 90 days', async () => {
    await notify(notice())
    const row = await t.container.prisma.notification.findFirstOrThrow()
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(90 * 86_400_000)
    expect(row.unread).toBe(true)
  })

  it('does not store a notice to oneself', async () => {
    await notify(notice({ actorId: recipient.id }))
    expect(await t.container.prisma.notification.count()).toBe(0)
  })

  it('does not store a duplicate eventKey for the same recipient', async () => {
    await notify(
      notice({ eventKey: 'like:post-1:abel' }),
      notice({ eventKey: 'like:post-1:abel', type: 'LIKE' }),
    )
    await notify(notice({ eventKey: 'like:post-1:abel' }))
    expect(await t.container.prisma.notification.count()).toBe(1)
  })

  it('does not notify a deleted account', async () => {
    await t.container.prisma.memberAccount.update({
      where: { id: recipient.id },
      data: { state: 'DELETED', authUserId: null, email: null, displayName: null },
    })
    await notify(notice())
    expect(await t.container.prisma.notification.count()).toBe(0)
  })

  it('stores nothing when the causing change rolls back', async () => {
    await expect(
      t.container.transactions.run(async (tx) => {
        await t.container.notifications.notify(tx, notice())
        throw new Error('change failed')
      }),
    ).rejects.toThrow('change failed')
    expect(await t.container.prisma.notification.count()).toBe(0)
  })
})

describe('notification endpoints', () => {
  it('lists unexpired notices newest first with the actor name; Administrator decisions name nobody', async () => {
    await notify(notice({ eventKey: 'old' }))
    t.clock.advance(60_000)
    await notify(
      notice({ eventKey: 'new', actorId: null, type: 'ALUMNI_DECISION', targetType: 'ALUMNI_REVIEW' }),
    )
    const client = api(t, recipient.token)
    const page = await client.get('/api/notifications')
    expect(page.status).toBe(200)
    expect(page.body).toMatchObject({ page: 1, pageSize: 20, total: 2 })
    expect(page.body.items).toEqual([
      expect.objectContaining({ type: 'ALUMNI_DECISION', actorId: null, actorName: null, unread: true }),
      expect.objectContaining({ type: 'COMMENT', actorId: actor.id, actorName: 'Abel Tadesse' }),
    ])

    t.clock.advance(90 * 86_400_000 - 30_000)
    const later = await client.get('/api/notifications')
    expect(later.body.items).toEqual([expect.objectContaining({ type: 'ALUMNI_DECISION' })])
  })

  it('pages with page 1 and sizes 1 to 50; a page past the end is empty', async () => {
    await notify(notice(), notice(), notice())
    const client = api(t, recipient.token)
    expect((await client.get('/api/notifications?page=2&pageSize=2')).body.items).toHaveLength(1)
    expect((await client.get('/api/notifications?page=9')).body.items).toEqual([])
    expect((await client.get('/api/notifications?pageSize=51')).status).toBe(422)
    expect((await client.get('/api/notifications?page=0')).status).toBe(422)
  })

  it('counts unread notices and marks one or all read, idempotently', async () => {
    await notify(notice(), notice(), notice())
    const client = api(t, recipient.token)
    expect((await client.get('/api/notifications/unread-count')).body).toEqual({ count: 3 })
    const [first] = (await client.get('/api/notifications')).body.items
    await client.post(`/api/notifications/${first.id}/read`).expect(204)
    await client.post(`/api/notifications/${first.id}/read`).expect(204)
    expect((await client.get('/api/notifications/unread-count')).body).toEqual({ count: 2 })
    await client.post('/api/notifications/read-all').expect(204)
    await client.post('/api/notifications/read-all').expect(204)
    expect((await client.get('/api/notifications/unread-count')).body).toEqual({ count: 0 })
  })

  it("reports another member's notice as not found", async () => {
    await notify(notice())
    const [row] = await t.container.prisma.notification.findMany()
    const response = await api(t, actor.token).post(`/api/notifications/${row!.id}/read`)
    expect(response.status).toBe(404)
    expect((await api(t, actor.token).post('/api/notifications/xyz/read')).status).toBe(404)
    expect((await api(t, actor.token).get('/api/notifications')).body.items).toEqual([])
  })

  it('is for members only', async () => {
    const admin = await createAdmin(t)
    expect((await api(t, admin.token).get('/api/notifications')).status).toBe(403)
  })
})
