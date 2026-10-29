import { randomUUID } from 'node:crypto'
import type { PostView } from '@hilcoe/shared'
import sharp from 'sharp'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionDeniedError } from '../../src/kernel/index.js'
import { resetDatabase } from '../helpers/database.js'
import { api, createAdmin, createMember, NOW, type TestMember } from '../helpers/members.js'
import { startTestApp, type TestApp } from '../helpers/test-app.js'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(() => t.close())
beforeEach(async () => {
  t.clock.set(NOW)
  t.storage.files.clear()
  vi.restoreAllMocks()
  await resetDatabase(t.container.prisma)
})

const png = (width = 40, height = 30) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

/** Multipart create (POST) or edit (PUT) with the JSON post field and image files. */
async function sendPost(
  member: TestMember,
  post: object,
  files: Buffer[] = [],
  target: { method: 'post' | 'put'; path: string } = { method: 'post', path: '/api/posts' },
) {
  const agent = request(t.app)
  const open = target.method === 'post' ? agent.post(target.path) : agent.put(target.path)
  let call = open.set('Authorization', `Bearer ${member.token}`).field('post', JSON.stringify(post))
  files.forEach((file, index) => {
    call = call.attach('images', file, `image-${index}.png`)
  })
  return call
}

async function createPost(member: TestMember, body = 'Hello HiLCoE', tags: string[] = []): Promise<PostView> {
  const response = await api(t, member.token).post('/api/posts', { body, tags })
  expect(response.status).toBe(201)
  return response.body as PostView
}

async function restrict(member: TestMember) {
  const prisma = t.container.prisma
  const violation = await prisma.violation.create({
    data: { memberId: member.id, targetType: 'POST', targetId: randomUUID(), decisionAt: NOW },
  })
  await prisma.consequence.create({
    data: {
      memberId: member.id,
      violationId: violation.id,
      kind: 'RESTRICTION',
      restrictUntil: new Date(NOW.getTime() + 14 * 86_400_000),
    },
  })
}

describe('Manage Own Post', () => {
  it('creates a post with images, alt text and normalized tags', async () => {
    const author = await createMember(t, { displayName: 'Abel' })
    const response = await sendPost(
      author,
      {
        body: '  Our senior project demo  ',
        tags: ['#AI', 'ai', 'Senior_Project'],
        images: [{ imageId: null, altText: 'Demo board' }, { imageId: null }],
      },
      [await png(3000, 1000), await png()],
    )
    expect(response.status).toBe(201)
    const post = response.body as PostView
    expect(post).toMatchObject({
      body: 'Our senior project demo',
      tags: ['ai', 'senior_project'],
      state: 'VISIBLE',
      version: 1,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      saveCount: 0,
      isOwn: true,
      editedAt: null,
      author: { memberId: author.id, displayName: 'Abel', role: 'STUDENT', deleted: false },
    })
    expect(post.images.map((image) => [image.position, image.altText])).toEqual([
      [1, 'Demo board'],
      [2, null],
    ])
    expect(post.images[0]?.url).toMatch(/^https:\/\/storage\.test\/post-images\/.+\?token=signed$/)
    expect(t.storage.files.size).toBe(2)
    const stored = [...t.storage.files.values()][0]!
    const meta = await sharp(Buffer.from(stored.bytes)).metadata()
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(1600)
  })

  it('is never empty and has at most four images and five tags', async () => {
    const author = await createMember(t)
    const client = api(t, author.token)
    const empty = await client.post('/api/posts', { body: '   ' })
    expect(empty.status).toBe(422)
    expect(empty.body.error.fields.body).toBeDefined()

    const tooManyTags = await client.post('/api/posts', { body: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
    expect(tooManyTags.status).toBe(422)
    const badTag = await client.post('/api/posts', { body: 'x', tags: ['two words'] })
    expect(badTag.status).toBe(422)
    expect(badTag.body.error.fields['tags.0']).toBeDefined()

    const image = await png()
    const five = await sendPost(
      author,
      { body: 'x', images: Array(5).fill({ imageId: null }) },
      Array(5).fill(image),
    )
    expect(five.status).toBe(422)
    expect(t.storage.files.size).toBe(0)

    const mismatch = await sendPost(author, { body: 'x', images: [{ imageId: null }] }, [])
    expect(mismatch.status).toBe(422)

    const imageOnly = await sendPost(author, { images: [{ imageId: null }] }, [image])
    expect(imageOnly.status).toBe(201)
    expect(imageOnly.body.body).toBeNull()
  })

  it('refuses an unaccepted image without storing anything', async () => {
    const author = await createMember(t)
    const response = await sendPost(author, { images: [{ imageId: null }, { imageId: null }] }, [
      await png(),
      Buffer.from('not an image'),
    ])
    expect(response.status).toBe(422)
    expect(response.body.error.fields['images.1']).toBeDefined()
    expect(t.storage.files.size).toBe(0)
  })

  it('removes the uploaded files when the transaction fails', async () => {
    const author = await createMember(t)
    vi.spyOn(t.container.accessPolicy, 'assertCanPublish').mockRejectedValueOnce(new PermissionDeniedError())
    const response = await sendPost(author, { body: 'x', images: [{ imageId: null }] }, [await png()])
    expect(response.status).toBe(403)
    expect(t.storage.files.size).toBe(0)
    expect(await t.container.prisma.post.count()).toBe(0)
  })

  it('edits text, images and tags with the version last read; a stale version gives 409', async () => {
    const author = await createMember(t)
    const created = await sendPost(
      author,
      { body: 'v1', tags: ['old'], images: [{ imageId: null }, { imageId: null }] },
      [await png(), await png()],
    )
    const post = created.body as PostView
    const [first, second] = post.images
    const keysBefore = [...t.storage.files.keys()]
    const path = `/api/posts/${post.id}`

    t.clock.set(new Date(NOW.getTime() + 60_000))
    const edited = await sendPost(
      author,
      {
        body: 'v2',
        tags: ['new'],
        version: 1,
        images: [
          { imageId: second!.id, altText: 'Kept' },
          { imageId: null, altText: 'Added' },
        ],
      },
      [await png()],
      { method: 'put', path },
    )
    expect(edited.status).toBe(200)
    expect(edited.body).toMatchObject({
      body: 'v2',
      tags: ['new'],
      version: 2,
      editedAt: '2026-10-01T09:01:00.000Z',
    })
    expect(edited.body.images.map((image: { id: string; altText: string }) => image.altText)).toEqual([
      'Kept',
      'Added',
    ])
    expect(edited.body.images[0].id).toBe(second!.id)
    // The dropped image's file is removed after the commit; the kept one stays.
    expect(t.storage.files.has(keysBefore[0]!)).toBe(false)
    expect(t.storage.files.size).toBe(2)
    expect(first).toBeDefined()

    const filesBefore = [...t.storage.files.keys()]
    const stale = await sendPost(
      author,
      { body: 'v3', version: 1, images: [{ imageId: null }] },
      [await png()],
      {
        method: 'put',
        path,
      },
    )
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('CONFLICT')
    // The file uploaded for the failed edit is removed again.
    expect([...t.storage.files.keys()]).toEqual(filesBefore)
  })

  it('refuses edits by others and images from another post', async () => {
    const author = await createMember(t)
    const other = await createMember(t)
    const post = await createPost(author)
    const byOther = await api(t, other.token).put(`/api/posts/${post.id}`, { body: 'x', version: 1 })
    expect(byOther.status).toBe(403)

    const foreign = (await sendPost(other, { images: [{ imageId: null }] }, [await png()])).body as PostView
    const stolen = await api(t, author.token).put(`/api/posts/${post.id}`, {
      body: 'x',
      version: 1,
      images: [{ imageId: foreign.images[0]!.id }],
    })
    expect(stolen.status).toBe(422)
    expect(stolen.body.error.fields['images.0.imageId']).toBeDefined()
  })

  it('archives on delete: clears text and images, keeps comments and tags, accepts no new interaction', async () => {
    const author = await createMember(t)
    const reader = await createMember(t)
    const post = (
      await sendPost(author, { body: 'bye', tags: ['farewell'], images: [{ imageId: null }] }, [await png()])
    ).body as PostView
    const comment = await api(t, reader.token).post(`/api/posts/${post.id}/comments`, { body: 'Nice' })
    expect(comment.status).toBe(201)

    expect((await api(t, reader.token).delete(`/api/posts/${post.id}`)).status).toBe(403)
    expect((await api(t, author.token).delete(`/api/posts/${post.id}`)).status).toBe(204)
    expect((await api(t, author.token).delete(`/api/posts/${post.id}`)).status).toBe(204)
    expect(t.storage.files.size).toBe(0)

    const archived = await api(t, reader.token).get(`/api/posts/${post.id}`)
    expect(archived.status).toBe(200)
    expect(archived.body).toMatchObject({
      state: 'ARCHIVED',
      body: null,
      images: [],
      tags: ['farewell'],
      commentCount: 1,
    })

    const reader2 = api(t, reader.token)
    expect((await reader2.post(`/api/posts/${post.id}/comments`, { body: 'Late' })).status).toBe(409)
    expect((await reader2.put(`/api/posts/${post.id}/likes`)).status).toBe(409)
    expect((await reader2.patch(`/api/comments/${comment.body.id}`, { body: 'x', version: 1 })).status).toBe(
      409,
    )
    expect((await api(t, author.token).put(`/api/posts/${post.id}`, { body: 'x', version: 2 })).status).toBe(
      409,
    )
    // A comment author may still delete their own comment.
    expect((await reader2.delete(`/api/comments/${comment.body.id}`)).status).toBe(204)
  })

  it('shows a hidden post only to its author', async () => {
    const author = await createMember(t)
    const other = await createMember(t)
    const post = await createPost(author)
    await t.container.prisma.post.update({ where: { id: post.id }, data: { state: 'HIDDEN' } })
    expect((await api(t, other.token).get(`/api/posts/${post.id}`)).status).toBe(404)
    expect((await api(t, other.token).get(`/api/posts/${post.id}/comments`)).status).toBe(404)
    const own = await api(t, author.token).get(`/api/posts/${post.id}`)
    expect(own.status).toBe(200)
    expect(own.body.state).toBe('HIDDEN')
    expect((await api(t, author.token).delete(`/api/posts/${post.id}`)).status).toBe(409)
  })

  it('stops a restricted member from posting or commenting but lets them delete their own content', async () => {
    const member = await createMember(t)
    const post = await createPost(member)
    const comment = await api(t, member.token).post(`/api/posts/${post.id}/comments`, { body: 'Mine' })
    await restrict(member)
    const client = api(t, member.token)

    const blocked = await sendPost(member, { body: 'x', images: [{ imageId: null }] }, [await png()])
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('RESTRICTED')
    expect(t.storage.files.size).toBe(0)
    expect((await client.post(`/api/posts/${post.id}/comments`, { body: 'x' })).body.error.code).toBe(
      'RESTRICTED',
    )
    expect((await client.put(`/api/posts/${post.id}`, { body: 'x', version: 1 })).body.error.code).toBe(
      'RESTRICTED',
    )
    expect(
      (await client.patch(`/api/comments/${comment.body.id}`, { body: 'x', version: 1 })).body.error.code,
    ).toBe('RESTRICTED')

    expect((await client.delete(`/api/comments/${comment.body.id}`)).status).toBe(204)
    expect((await client.delete(`/api/posts/${post.id}`)).status).toBe(204)
    // Likes and saves remain available during a posting restriction.
    const other = await createPost(await createMember(t))
    expect((await client.put(`/api/posts/${other.id}/likes`)).status).toBe(200)
  })

  it('keeps Self-Reported Alumni from posting', async () => {
    const alumni = await createMember(t, { role: 'ALUMNI', alumniStatus: 'SELF_REPORTED' })
    expect((await api(t, alumni.token).post('/api/posts', { body: 'x' })).status).toBe(403)
  })

  it('is for members only', async () => {
    const admin = await createAdmin(t)
    expect((await api(t, admin.token).get('/api/posts')).status).toBe(403)
    expect((await request(t.app).get('/api/posts')).status).toBe(401)
  })
})

describe('Manage Own Comment', () => {
  it('attaches replies to replies to the top-level comment and notifies', async () => {
    const author = await createMember(t, { displayName: 'Author' })
    const first = await createMember(t, { displayName: 'First' })
    const second = await createMember(t, { displayName: 'Second' })
    const post = await createPost(author)
    const top = await api(t, first.token).post(`/api/posts/${post.id}/comments`, { body: 'Top' })
    const reply = await api(t, second.token).post(`/api/posts/${post.id}/comments`, {
      body: 'Reply',
      parentCommentId: top.body.id,
    })
    const nested = await api(t, author.token).post(`/api/posts/${post.id}/comments`, {
      body: 'Reply to reply',
      parentCommentId: reply.body.id,
    })
    expect(reply.body.parentCommentId).toBe(top.body.id)
    expect(nested.body.parentCommentId).toBe(top.body.id)

    const list = await api(t, author.token).get(`/api/posts/${post.id}/comments`)
    expect(list.body.total).toBe(1)
    expect(list.body.items[0].replies.map((r: { body: string }) => r.body)).toEqual([
      'Reply',
      'Reply to reply',
    ])

    const notices = await t.container.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } })
    expect(notices.map((n) => [n.recipientId, n.type, n.targetType])).toEqual(
      expect.arrayContaining([
        [author.id, 'COMMENT', 'COMMENT'],
        [first.id, 'REPLY', 'COMMENT'],
        [second.id, 'REPLY', 'COMMENT'],
      ]),
    )
    expect(notices).toHaveLength(3)
    expect((await api(t, author.token).get('/api/posts/' + post.id)).body.commentCount).toBe(3)
  })

  it('keeps the replies of a deleted comment behind a placeholder', async () => {
    const author = await createMember(t)
    const commenter = await createMember(t)
    const post = await createPost(author)
    const top = await api(t, commenter.token).post(`/api/posts/${post.id}/comments`, { body: 'Top' })
    const lonely = await api(t, commenter.token).post(`/api/posts/${post.id}/comments`, { body: 'Alone' })
    await api(t, author.token).post(`/api/posts/${post.id}/comments`, {
      body: 'Reply',
      parentCommentId: top.body.id,
    })

    expect((await api(t, author.token).delete(`/api/comments/${top.body.id}`)).status).toBe(403)
    expect((await api(t, commenter.token).delete(`/api/comments/${top.body.id}`)).status).toBe(204)
    expect((await api(t, commenter.token).delete(`/api/comments/${lonely.body.id}`)).status).toBe(204)

    const list = await api(t, author.token).get(`/api/posts/${post.id}/comments`)
    expect(list.body.total).toBe(1)
    expect(list.body.items[0]).toMatchObject({ state: 'DELETED', body: null, author: null })
    expect(list.body.items[0].replies).toHaveLength(1)

    const replyToDeleted = await api(t, author.token).post(`/api/posts/${post.id}/comments`, {
      body: 'x',
      parentCommentId: top.body.id,
    })
    expect(replyToDeleted.status).toBe(409)
  })

  it('edits with the version last read', async () => {
    const author = await createMember(t)
    const post = await createPost(author)
    const comment = await api(t, author.token).post(`/api/posts/${post.id}/comments`, { body: 'Draft' })
    const edited = await api(t, author.token).patch(`/api/comments/${comment.body.id}`, {
      body: 'Final',
      version: 1,
    })
    expect(edited.body).toMatchObject({ body: 'Final', version: 2 })
    expect(edited.body.editedAt).not.toBeNull()
    const stale = await api(t, author.token).patch(`/api/comments/${comment.body.id}`, {
      body: 'Again',
      version: 1,
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('CONFLICT')
    const blank = await api(t, author.token).patch(`/api/comments/${comment.body.id}`, {
      body: ' ',
      version: 2,
    })
    expect(blank.status).toBe(422)
    const other = await createMember(t)
    expect(
      (await api(t, other.token).patch(`/api/comments/${comment.body.id}`, { body: 'x', version: 2 })).status,
    ).toBe(403)
  })
})

describe('Like or Unlike Content', () => {
  it('is unique per member and item, never on one own item, and only the first like notifies', async () => {
    const author = await createMember(t)
    const fan = await createMember(t, { displayName: 'Fan' })
    const post = await createPost(author)
    const client = api(t, fan.token)

    expect((await client.put(`/api/posts/${post.id}/likes`)).body).toEqual({ liked: true, likeCount: 1 })
    expect((await client.put(`/api/posts/${post.id}/likes`)).body).toEqual({ liked: true, likeCount: 1 })
    expect((await client.delete(`/api/posts/${post.id}/likes`)).body).toEqual({ liked: false, likeCount: 0 })
    expect((await client.put(`/api/posts/${post.id}/likes`)).body).toEqual({ liked: true, likeCount: 1 })
    expect(await t.container.prisma.like.count()).toBe(1)
    expect(await t.container.prisma.notification.count({ where: { type: 'LIKE' } })).toBe(1)

    const own = await api(t, author.token).put(`/api/posts/${post.id}/likes`)
    expect(own.status).toBe(403)

    const likers = await api(t, author.token).get(`/api/posts/${post.id}/likes`)
    expect(likers.body.items).toEqual([expect.objectContaining({ memberId: fan.id, displayName: 'Fan' })])
    const view = await client.get(`/api/posts/${post.id}`)
    expect(view.body).toMatchObject({ likeCount: 1, likedByMe: true })
  })

  it('likes comments and notifies the comment author', async () => {
    const author = await createMember(t)
    const commenter = await createMember(t)
    const post = await createPost(author)
    const comment = await api(t, commenter.token).post(`/api/posts/${post.id}/comments`, { body: 'Hi' })
    const liked = await api(t, author.token).put(`/api/comments/${comment.body.id}/likes`)
    expect(liked.body).toEqual({ liked: true, likeCount: 1 })
    const notice = await t.container.prisma.notification.findFirst({ where: { type: 'LIKE' } })
    expect(notice).toMatchObject({
      recipientId: commenter.id,
      targetType: 'COMMENT',
      targetId: comment.body.id,
    })
    expect((await api(t, commenter.token).put(`/api/comments/${comment.body.id}/likes`)).status).toBe(403)
  })

  it('keeps Self-Reported and Flagged Alumni from liking or saving', async () => {
    const post = await createPost(await createMember(t))
    for (const alumniStatus of ['SELF_REPORTED', 'FLAGGED'] as const) {
      const alumni = await createMember(t, { role: 'ALUMNI', alumniStatus })
      const client = api(t, alumni.token)
      expect((await client.put(`/api/posts/${post.id}/likes`)).status).toBe(403)
      expect((await client.put(`/api/saved-items/posts/${post.id}`)).status).toBe(403)
      expect((await client.delete(`/api/saved-items/posts/${post.id}`)).status).toBe(204)
      expect((await client.get(`/api/posts/${post.id}`)).status).toBe(200)
    }
  })
})

describe('View Post Details', () => {
  it('counts a view once per member, post and UTC day, never for the author', async () => {
    const author = await createMember(t)
    const reader = await createMember(t)
    const post = await createPost(author)
    const view = (member: TestMember) => api(t, member.token).post(`/api/posts/${post.id}/views`)

    expect((await view(reader)).status).toBe(204)
    await view(reader)
    await view(author)
    expect((await api(t, reader.token).get(`/api/posts/${post.id}`)).body.viewCount).toBe(1)

    t.clock.set(new Date('2026-10-02T00:00:01Z'))
    await view(reader)
    expect((await api(t, reader.token).get(`/api/posts/${post.id}`)).body.viewCount).toBe(2)
    // Only the current day's marks are kept.
    const marks = await t.container.prisma.postViewDay.findMany()
    expect(marks.map((mark) => mark.utcDate.toISOString().slice(0, 10))).toEqual(['2026-10-02'])
  })

  it('never counts an Administrator', async () => {
    const post = await createPost(await createMember(t))
    const admin = await createAdmin(t)
    expect((await api(t, admin.token).post(`/api/posts/${post.id}/views`)).status).toBe(403)
    expect(await t.container.prisma.postViewDay.count()).toBe(0)
  })
})

describe('Account deletion', () => {
  it('keeps posts, comments and likes as Deleted User and removes view marks', async () => {
    const leaver = await createMember(t, { displayName: 'Leaver' })
    const author = await createMember(t)
    const post = await createPost(author)
    const own = await createPost(leaver)
    await api(t, leaver.token).post(`/api/posts/${post.id}/comments`, { body: 'Bye' })
    await api(t, leaver.token).put(`/api/posts/${post.id}/likes`)
    await api(t, leaver.token).post(`/api/posts/${post.id}/views`)
    expect(await t.container.prisma.postViewDay.count()).toBe(1)

    await t.container.transactions.run((tx) =>
      t.container.lifecycle.publish(tx, {
        kind: 'ACCOUNT_DELETED',
        memberId: leaver.id,
        newRole: null,
        occurredAt: NOW,
      }),
    )
    await t.container.prisma.memberAccount.update({
      where: { id: leaver.id },
      data: { state: 'DELETED', displayName: null, email: null, authUserId: null },
    })
    expect(await t.container.prisma.postViewDay.count()).toBe(0)

    const client = api(t, author.token)
    expect((await client.get(`/api/posts/${own.id}`)).body.author).toEqual({
      memberId: null,
      displayName: 'Deleted User',
      role: null,
      alumniStatus: null,
      pictureUrl: null,
      deleted: true,
    })
    expect((await client.get(`/api/posts/${post.id}/comments`)).body.items[0].author.displayName).toBe(
      'Deleted User',
    )
    const likers = await client.get(`/api/posts/${post.id}/likes`)
    expect(likers.body.items).toEqual([expect.objectContaining({ deleted: true, memberId: null })])
    expect((await client.get(`/api/posts/${post.id}`)).body.likeCount).toBe(1)
  })
})
