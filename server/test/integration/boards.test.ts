import type { PostView } from '@hilcoe/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetDatabase } from '../helpers/database.js'
import { api, createMember, NOW, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp
const HOUR = 3_600_000
const DAY = 24 * HOUR

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  t.storage.files.clear()
  await resetDatabase(t.container.prisma)
})

async function createPost(member: TestMember, body: string, tags: string[] = []): Promise<PostView> {
  const response = await api(t, member.token).post('/api/posts', { body, tags })
  expect(response.status).toBe(201)
  return response.body as PostView
}

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('Home feed', () => {
  it('lists visible posts newest first with offset pages; archived and hidden posts leave it', async () => {
    const author = await createMember(t)
    const reader = await createMember(t)
    const first = await createPost(author, 'first')
    t.clock.advance(HOUR)
    const second = await createPost(author, 'second')
    t.clock.advance(HOUR)
    const third = await createPost(author, 'third')
    const hidden = await createPost(author, 'hidden')
    await t.container.prisma.post.update({ where: { id: hidden.id }, data: { state: 'HIDDEN' } })
    await api(t, author.token).delete(`/api/posts/${second.id}`)

    const feed = await api(t, reader.token).get('/api/posts?pageSize=1')
    expect(feed.body).toMatchObject({ page: 1, pageSize: 1, total: 2 })
    expect(ids(feed.body.items)).toEqual([third.id])
    expect(ids((await api(t, reader.token).get('/api/posts?page=2&pageSize=1')).body.items)).toEqual([
      first.id,
    ])
    expect((await api(t, reader.token).get('/api/posts?page=9')).body.items).toEqual([])
    expect((await api(t, reader.token).get('/api/posts?pageSize=51')).status).toBe(422)
  })
})

describe('Trending', () => {
  it('ranks posts of the last seven days by (3L + 4C + 0.1V) / (1 + A), ties to the newer post', async () => {
    const author = await createMember(t)
    const fans = await Promise.all([createMember(t), createMember(t), createMember(t)])
    t.clock.set(new Date(NOW.getTime() - 8 * DAY))
    const tooOld = await createPost(author, 'too old')
    t.clock.set(new Date(NOW.getTime() - DAY))
    const older = await createPost(author, 'older')
    t.clock.set(NOW)
    const newer = await createPost(author, 'newer')
    const quiet = await createPost(author, 'quiet')
    const archived = await createPost(author, 'archived')

    // older: 2 likes, 0 commenters, 1 day old -> 6 / 2 = 3. newer: 1 like -> 3 / 1 = 3 (tie).
    for (const fan of fans.slice(0, 2)) await api(t, fan.token).put(`/api/posts/${older.id}/likes`)
    await api(t, fans[0]!.token).put(`/api/posts/${newer.id}/likes`)
    // tooOld would lead if it were in range; archived posts are excluded.
    for (const fan of fans) {
      await api(t, fan.token).put(`/api/posts/${tooOld.id}/likes`)
      await api(t, fan.token).put(`/api/posts/${archived.id}/likes`)
      await api(t, fan.token).post(`/api/posts/${archived.id}/comments`, { body: 'Hi' })
    }
    await api(t, author.token).delete(`/api/posts/${archived.id}`)

    const trending = await api(t, fans[2]!.token).get('/api/posts/trending')
    expect(trending.status).toBe(200)
    expect(ids(trending.body)).toEqual([newer.id, older.id, quiet.id])
    expect(ids((await api(t, fans[2]!.token).get('/api/posts/trending?limit=1')).body)).toEqual([newer.id])

    // Two distinct commenters weigh 4 each; repeat comments by one member count once.
    await api(t, fans[0]!.token).post(`/api/posts/${quiet.id}/comments`, { body: 'a' })
    await api(t, fans[0]!.token).post(`/api/posts/${quiet.id}/comments`, { body: 'b' })
    expect(ids((await api(t, fans[2]!.token).get('/api/posts/trending')).body)[0]).toBe(quiet.id)
  }, 90_000)
})

describe('Search', () => {
  it('finds visible posts by text and tag, ranked by relevance then recency', async () => {
    const author = await createMember(t)
    const reader = await createMember(t)
    const once = await createPost(author, 'An internship at a bank', ['career'])
    t.clock.advance(HOUR)
    const twice = await createPost(author, 'Internship tips: internship interviews', ['career'])
    t.clock.advance(HOUR)
    const other = await createPost(author, 'Football on Friday', ['sports'])
    const archived = await createPost(author, 'Internship archived', ['career'])
    await api(t, author.token).delete(`/api/posts/${archived.id}`)

    const client = api(t, reader.token)
    const byText = await client.get('/api/search?text=internship')
    expect(byText.status).toBe(200)
    expect(ids(byText.body.posts.items)).toEqual([twice.id, once.id])

    const byTag = await client.get('/api/search?tag=%23Career')
    expect(ids(byTag.body.posts.items)).toEqual([twice.id, once.id])
    expect(byTag.body.posts.total).toBe(2)

    const both = await client.get('/api/search?text=football&tag=career')
    expect(both.body.posts.items).toEqual([])
    expect(ids((await client.get('/api/search?tag=sports')).body.posts.items)).toEqual([other.id])

    expect((await client.get('/api/search')).status).toBe(422)
    expect((await client.get('/api/search?text=x&category=MENTORS')).body).toEqual({
      posts: null,
      opportunities: null,
      groups: null,
      mentors: { items: [], page: 1, pageSize: 20, total: 0 },
    })
  })
})

describe('Saved items', () => {
  it('saves privately and idempotently; an archived post stays with its state', async () => {
    const author = await createMember(t)
    const saver = await createMember(t)
    const post = await createPost(author, 'Keep this')
    t.clock.advance(HOUR)
    const later = await createPost(author, 'And this')
    const client = api(t, saver.token)

    expect((await client.put(`/api/saved-items/posts/${post.id}`)).status).toBe(204)
    expect((await client.put(`/api/saved-items/posts/${post.id}`)).status).toBe(204)
    t.clock.advance(HOUR)
    await client.put(`/api/saved-items/posts/${later.id}`)

    const view = await api(t, author.token).get(`/api/posts/${post.id}`)
    expect(view.body).toMatchObject({ saveCount: 1, savedByMe: false })
    expect((await client.get(`/api/posts/${post.id}`)).body.savedByMe).toBe(true)

    await api(t, author.token).delete(`/api/posts/${post.id}`)
    const saved = await client.get('/api/saved-items')
    expect(saved.body.total).toBe(2)
    expect(
      saved.body.items.map((item: { targetId: string; state: string }) => [item.targetId, item.state]),
    ).toEqual([
      [later.id, 'VISIBLE'],
      [post.id, 'ARCHIVED'],
    ])
    expect(saved.body.items[1].post).toMatchObject({ state: 'ARCHIVED', body: null })
    // An archived post cannot be saved again, but the save can be removed.
    const other = await createMember(t)
    expect((await api(t, other.token).put(`/api/saved-items/posts/${post.id}`)).status).toBe(409)
    expect((await client.delete(`/api/saved-items/posts/${post.id}`)).status).toBe(204)
    expect((await client.get('/api/saved-items')).body.total).toBe(1)
    // Saved lists are private to their owner.
    expect((await api(t, author.token).get('/api/saved-items')).body.total).toBe(0)
  })

  it('shows a post hidden from the saver by its state only', async () => {
    const author = await createMember(t)
    const saver = await createMember(t)
    const post = await createPost(author, 'Soon hidden')
    await api(t, saver.token).put(`/api/saved-items/posts/${post.id}`)
    await t.container.prisma.post.update({ where: { id: post.id }, data: { state: 'HIDDEN' } })
    const saved = await api(t, saver.token).get('/api/saved-items')
    expect(saved.body.items[0]).toMatchObject({ state: 'HIDDEN', post: null })
  })

  it('refuses unknown targets and types', async () => {
    const saver = await createMember(t)
    const client = api(t, saver.token)
    expect((await client.put('/api/saved-items/posts/00000000-0000-7000-8000-000000000000')).status).toBe(404)
    expect((await client.put('/api/saved-items/widgets/00000000-0000-7000-8000-000000000000')).status).toBe(
      404,
    )
    for (const type of ['opportunities', 'groups']) {
      const missing = await client.put(`/api/saved-items/${type}/00000000-0000-7000-8000-000000000000`)
      expect(missing.status).toBe(404)
    }
  })
})
