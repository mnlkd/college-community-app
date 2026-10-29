import { randomUUID } from 'node:crypto'
import {
  commentEditInputSchema,
  commentInputSchema,
  pageRequestSchema,
  postEditInputSchema,
  postInputSchema,
  searchQuerySchema,
  type CommentView,
  type EvidenceImageView,
  type Page,
  type PostSummaryView,
  type PostView,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import { removeStoredFiles, type AccessPolicy } from '../identity/index.js'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  RestrictionError,
  ValidationError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type ContentSnapshot,
  type FileStorage,
  type ImageProcessing,
  type TransactionRunner,
  type Tx,
  type WarningLogger,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { canSeePost, lockComment, lockPost, lockVisibleComment, lockVisiblePost } from './post-access.js'
import { COMMENT_SELECT, type PostDescription, type PostViews } from './post-views.js'
import { setPostTags } from './tags.js'

const POST_BUCKET = 'post-images'
/** Upper bound on the recent posts considered for trending. */
const TRENDING_CANDIDATES = 1000

/** Trending inputs of one recent visible post (FR-20). */
export interface PostStat {
  postId: string
  likes: number
  commenters: number
  views: number
  createdAt: Date
}

export interface PublishingServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  storage: FileStorage
  images: ImageProcessing
  notifications: NotificationService
  views: PostViews
  logger: WarningLogger
}

/** The reportable publishing targets (ReportTargetType without OPPORTUNITY). */
export type PublishingTargetType = 'POST' | 'COMMENT'

interface ImageSlot {
  imageId: string | null
  altText: string | null
}

/** Posts, comments and post search (ODD Table 10). */
export class PublishingService {
  constructor(private readonly deps: PublishingServiceDeps) {}

  /** Stores the processed images first; they are removed again when the post is not saved. */
  async createPost(actor: ActorContext, input: unknown, files: readonly Uint8Array[]): Promise<PostView> {
    const memberId = this.publisher(actor)
    const post = parseInput(postInputSchema, input)
    post.images.forEach((slot, index) => {
      if (slot.imageId !== null) {
        throw new ValidationError({ [`images.${index}.imageId`]: 'A new post has no earlier images.' })
      }
    })
    const newKeys = await this.storeImages(memberId, post.images, files)
    let postId: string
    try {
      postId = await this.deps.transactions.run(async (tx) => {
        await this.deps.access.assertCanPublish(tx, actor)
        const now = this.deps.clock.now()
        const created = await tx.post.create({
          data: { authorId: memberId, body: post.body, createdAt: now, updatedAt: now },
          select: { id: true },
        })
        await this.saveImages(tx, created.id, post.images, new Map(), newKeys)
        await setPostTags(tx, created.id, post.tags)
        return created.id
      })
    } catch (error) {
      await this.removeFiles(newKeys)
      throw error
    }
    return this.getPost(actor, postId)
  }

  /**
   * Replaces the text, images and tags of the author's VISIBLE post. Images the input keeps are
   * named by id; images it drops are removed once the change has committed.
   */
  async editPost(
    actor: ActorContext,
    postId: string,
    input: unknown,
    files: readonly Uint8Array[],
  ): Promise<PostView> {
    const memberId = this.publisher(actor)
    const post = parseInput(postEditInputSchema, input)
    const newKeys = await this.storeImages(memberId, post.images, files)
    let droppedKeys: string[]
    try {
      droppedKeys = await this.deps.transactions.run(async (tx) => {
        await this.deps.access.assertCanPublish(tx, actor)
        const locked = await lockVisiblePost(tx, postId, memberId, 'UPDATE')
        if (locked.author_id !== memberId)
          throw new PermissionDeniedError('Only the author can edit this post.')
        if (locked.state !== 'VISIBLE') throw new ConflictError('This post can no longer be edited.')
        if (locked.version !== post.version) throw new ConflictError()

        const existing = await tx.postImage.findMany({ where: { postId, position: { not: null } } })
        const existingById = new Map(existing.map((image) => [image.id, image]))
        const kept = new Set<string>()
        post.images.forEach((slot, index) => {
          if (slot.imageId === null) return
          if (!existingById.has(slot.imageId) || kept.has(slot.imageId)) {
            throw new ValidationError({ [`images.${index}.imageId`]: 'This image is not part of the post.' })
          }
          kept.add(slot.imageId)
        })
        // Images held as evidence keep their rows: they are detached here and placed again below
        // when the input keeps them; dropped ones stay detached until the evidence is purged.
        await tx.postImage.updateMany({ where: { postId, evidenceHold: true }, data: { position: null } })
        await tx.postImage.deleteMany({ where: { postId, evidenceHold: false } })
        await this.saveImages(tx, postId, post.images, existingById, newKeys)
        await setPostTags(tx, postId, post.tags)
        await tx.post.update({
          where: { id: postId },
          data: { body: post.body, version: { increment: 1 }, updatedAt: this.deps.clock.now() },
        })
        return existing
          .filter((image) => !kept.has(image.id) && !image.evidenceHold)
          .map((image) => image.storageKey)
      })
    } catch (error) {
      await this.removeFiles(newKeys)
      throw error
    }
    await this.removeFiles(droppedKeys)
    return this.getPost(actor, postId)
  }

  /**
   * The author archives the post, also during a restriction. The archive keeps its comments, tags
   * and saves; its text and images are removed. Deleting an archived post again does nothing.
   */
  async deletePost(actor: ActorContext, postId: string): Promise<void> {
    const memberId = this.member(actor)
    const keys = await this.deps.transactions.run(async (tx) => {
      const locked = await lockVisiblePost(tx, postId, memberId, 'UPDATE')
      if (locked.author_id !== memberId)
        throw new PermissionDeniedError('Only the author can delete this post.')
      if (locked.state === 'ARCHIVED') return []
      if (locked.state === 'HIDDEN') throw new ConflictError('This post was hidden after a report.')
      const where = { postId, evidenceHold: false }
      const images = await tx.postImage.findMany({ where, select: { storageKey: true } })
      await tx.postImage.deleteMany({ where })
      await tx.post.update({
        where: { id: postId },
        data: { state: 'ARCHIVED', body: null, version: { increment: 1 }, updatedAt: this.deps.clock.now() },
      })
      return images.map((image) => image.storageKey)
    })
    await this.removeFiles(keys)
  }

  async getPost(actor: ActorContext, postId: string): Promise<PostView> {
    const memberId = this.member(actor)
    const view = (await this.deps.views.describe(memberId, [postId])).get(postId)?.view
    if (!view) throw new NotFoundError('The post was not found.')
    return view
  }

  /** Visible posts newest first (the Home feed). */
  async listPosts(actor: ActorContext, page: unknown): Promise<Page<PostSummaryView>> {
    const memberId = this.member(actor)
    const request = parseInput(pageRequestSchema, page)
    const where = { state: 'VISIBLE' as const }
    const [rows, total] = await Promise.all([
      this.deps.db.post.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
        ...pageWindow(request),
      }),
      this.deps.db.post.count({ where }),
    ])
    const items = await this.deps.views.summaries(
      memberId,
      rows.map((row) => row.id),
    )
    return toPage(items, request, total)
  }

  /**
   * Describes posts for boards (trending, saved items): the state of each post, and its view
   * unless it is hidden from the member.
   */
  async describePosts(
    actor: ActorContext,
    postIds: readonly string[],
  ): Promise<Map<string, PostDescription>> {
    return this.deps.views.describe(this.member(actor), postIds)
  }

  /**
   * Full-text search of visible posts by text and tag, ranked by relevance then recency. Called by
   * BoardsService.
   */
  async searchPosts(actor: ActorContext, query: unknown): Promise<Page<PostSummaryView>> {
    const memberId = this.member(actor)
    const { text, tag, ...request } = parseInput(searchQuerySchema, query)
    const { skip, take } = pageWindow(request)
    const [rows, counts] = await Promise.all([
      this.deps.db.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM post p
        WHERE p.state = 'VISIBLE'
          AND (${text}::text IS NULL OR p.search_vector @@ websearch_to_tsquery('simple', ${text}::text))
          AND (${tag}::text IS NULL OR EXISTS (
            SELECT 1 FROM post_tag pt JOIN tag t ON t.id = pt.tag_id
            WHERE pt.post_id = p.id AND t.normalized_label = ${tag}::text))
        ORDER BY
          CASE WHEN ${text}::text IS NULL THEN 0
               ELSE ts_rank(p.search_vector, websearch_to_tsquery('simple', ${text}::text)) END DESC,
          p.created_at DESC, p.id DESC
        LIMIT ${take} OFFSET ${skip}`,
      this.deps.db.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM post p
        WHERE p.state = 'VISIBLE'
          AND (${text}::text IS NULL OR p.search_vector @@ websearch_to_tsquery('simple', ${text}::text))
          AND (${tag}::text IS NULL OR EXISTS (
            SELECT 1 FROM post_tag pt JOIN tag t ON t.id = pt.tag_id
            WHERE pt.post_id = p.id AND t.normalized_label = ${tag}::text))`,
    ])
    const items = await this.deps.views.summaries(
      memberId,
      rows.map((row) => row.id),
    )
    return toPage(items, { page: request.page, pageSize: request.pageSize }, counts[0]?.total ?? 0)
  }

  /** Trending inputs of visible posts created since the given time, newest first. */
  async listPostStats(since: Date, limit = TRENDING_CANDIDATES): Promise<PostStat[]> {
    const rows = await this.deps.db.$queryRaw<
      { id: string; created_at: Date; view_count: number; likes: number; commenters: number }[]
    >`
      SELECT p.id, p.created_at, p.view_count,
        (SELECT count(*)::int FROM "like" l WHERE l.post_id = p.id AND l.active) AS likes,
        (SELECT count(DISTINCT c.author_id)::int FROM comment c
          WHERE c.post_id = p.id AND c.state = 'VISIBLE') AS commenters
      FROM post p
      WHERE p.state = 'VISIBLE' AND p.created_at >= ${since}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${limit}`
    return rows.map((row) => ({
      postId: row.id,
      likes: row.likes,
      commenters: row.commenters,
      views: row.view_count,
      createdAt: row.created_at,
    }))
  }

  /**
   * Checks, in the caller's transaction, that the member may save the post: they can interact and
   * the post is VISIBLE. The post row stays share-locked until the transaction ends.
   */
  async assertPostSaveable(tx: Tx, actor: ActorContext, postId: string): Promise<void> {
    await this.deps.access.assertCanInteract(tx, actor)
    const post = await lockVisiblePost(tx, postId, actor.accountId, 'SHARE')
    if (post.state !== 'VISIBLE') throw new ConflictError('This post is archived and cannot be saved.')
  }

  /**
   * Adds a comment, or a reply to a comment, on a VISIBLE post. A reply to a reply attaches to the
   * same top-level comment. Notifies the author of the post, or of the comment replied to.
   */
  async createComment(actor: ActorContext, postId: string, input: unknown): Promise<CommentView> {
    const memberId = this.publisher(actor)
    const comment = parseInput(commentInputSchema, input)
    const commentId = await this.deps.transactions.run(async (tx) => {
      await this.deps.access.assertCanPublish(tx, actor)
      const post = await lockVisiblePost(tx, postId, memberId, 'SHARE')
      if (post.state !== 'VISIBLE') throw new ConflictError('This post accepts no new comments.')
      let parent: { id: string; parentCommentId: string | null; authorId: string } | null = null
      if (comment.parentCommentId !== null) {
        const found = await tx.comment.findUnique({
          where: { id: comment.parentCommentId },
          select: { id: true, postId: true, parentCommentId: true, authorId: true, state: true },
        })
        if (!found || found.postId !== postId || found.state === 'HIDDEN') {
          throw new NotFoundError('The comment was not found.')
        }
        if (found.state !== 'VISIBLE') throw new ConflictError('This comment was deleted.')
        parent = found
      }
      const now = this.deps.clock.now()
      const created = await tx.comment.create({
        data: {
          postId,
          authorId: memberId,
          parentCommentId: parent ? (parent.parentCommentId ?? parent.id) : null,
          body: comment.body,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
      await this.deps.notifications.notify(tx, {
        recipientId: parent ? parent.authorId : post.author_id,
        type: parent ? 'REPLY' : 'COMMENT',
        eventKey: `${parent ? 'reply' : 'comment'}:${created.id}`,
        actorId: memberId,
        targetType: 'COMMENT',
        targetId: created.id,
      })
      return created.id
    })
    return this.getComment(actor, commentId)
  }

  async editComment(actor: ActorContext, commentId: string, input: unknown): Promise<CommentView> {
    const memberId = this.publisher(actor)
    const edit = parseInput(commentEditInputSchema, input)
    await this.deps.transactions.run(async (tx) => {
      await this.deps.access.assertCanPublish(tx, actor)
      const { comment, post } = await lockVisibleComment(tx, commentId, memberId, 'UPDATE')
      if (comment.author_id !== memberId)
        throw new PermissionDeniedError('Only the author can edit this comment.')
      if (comment.state !== 'VISIBLE') throw new ConflictError('This comment was deleted.')
      if (post.state !== 'VISIBLE') throw new ConflictError('This post accepts no changes.')
      if (comment.version !== edit.version) throw new ConflictError()
      await tx.comment.update({
        where: { id: commentId },
        data: { body: edit.body, version: { increment: 1 }, updatedAt: this.deps.clock.now() },
      })
    })
    return this.getComment(actor, commentId)
  }

  /**
   * Deletes the author's comment to a placeholder that keeps its replies. Allowed during a
   * restriction and on an archived post; deleting it again does nothing.
   */
  async deleteComment(actor: ActorContext, commentId: string): Promise<void> {
    const memberId = this.member(actor)
    await this.deps.transactions.run(async (tx) => {
      const { comment } = await lockVisibleComment(tx, commentId, memberId, 'UPDATE')
      if (comment.author_id !== memberId)
        throw new PermissionDeniedError('Only the author can delete this comment.')
      if (comment.state === 'DELETED') return
      await tx.comment.update({
        where: { id: commentId },
        data: { body: null, state: 'DELETED', version: { increment: 1 }, updatedAt: this.deps.clock.now() },
      })
    })
  }

  /** One comment without its replies; used to open a comment from a notice. */
  async getComment(actor: ActorContext, commentId: string): Promise<CommentView> {
    const memberId = this.member(actor)
    const row = await this.deps.db.comment.findUnique({
      where: { id: commentId },
      select: { ...COMMENT_SELECT, post: { select: { state: true, authorId: true } } },
    })
    if (!row || row.state === 'HIDDEN' || !canSeePost(row.post, memberId)) {
      throw new NotFoundError('The comment was not found.')
    }
    const [view] = await this.deps.views.comments(memberId, [row])
    if (!view) throw new NotFoundError('The comment was not found.')
    return view
  }

  /**
   * Top-level comments oldest first, each with its visible replies. A deleted or hidden comment is
   * listed as a placeholder only while it has visible replies.
   */
  async listComments(actor: ActorContext, postId: string, page: unknown): Promise<Page<CommentView>> {
    const memberId = this.member(actor)
    const request = parseInput(pageRequestSchema, page)
    const post = await this.deps.db.post.findUnique({
      where: { id: postId },
      select: { state: true, authorId: true },
    })
    if (!post || !canSeePost(post, memberId)) throw new NotFoundError('The post was not found.')
    const where = {
      postId,
      parentCommentId: null,
      OR: [{ state: 'VISIBLE' as const }, { replies: { some: { state: 'VISIBLE' as const } } }],
    }
    const [topLevel, total] = await Promise.all([
      this.deps.db.comment.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: COMMENT_SELECT,
        ...pageWindow(request),
      }),
      this.deps.db.comment.count({ where }),
    ])
    const replies = await this.deps.db.comment.findMany({
      where: { parentCommentId: { in: topLevel.map((row) => row.id) }, state: 'VISIBLE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: COMMENT_SELECT,
    })
    return toPage(await this.deps.views.comments(memberId, topLevel, replies), request, total)
  }

  /**
   * Called by ModerationService: the author of each post or comment, and the post it belongs to,
   * read without locks. Unknown ids are left out.
   */
  async contentAuthors(
    tx: Tx,
    targetType: PublishingTargetType,
    ids: readonly string[],
  ): Promise<Map<string, { authorId: string; postId: string }>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const rows =
      targetType === 'POST'
        ? (
            await tx.post.findMany({ where: { id: { in: unique } }, select: { id: true, authorId: true } })
          ).map((row) => ({ ...row, postId: row.id }))
        : await tx.comment.findMany({
            where: { id: { in: unique } },
            select: { id: true, authorId: true, postId: true },
          })
    return new Map(rows.map((row) => [row.id, { authorId: row.authorId, postId: row.postId }]))
  }

  /**
   * Called by ModerationService when a member reports a post or comment: copies its text and
   * holds its images as evidence, so later edits or deletion cannot change them. Content the
   * member may not see is not found; an archived post or deleted comment has nothing to report.
   */
  async captureSnapshot(
    tx: Tx,
    targetType: PublishingTargetType,
    targetId: string,
    viewerId: string,
  ): Promise<ContentSnapshot> {
    if (targetType === 'POST') {
      const post = await lockVisiblePost(tx, targetId, viewerId, 'SHARE')
      if (post.state === 'ARCHIVED') throw new ConflictError('This post was deleted by its author.')
      const row = await tx.post.findUniqueOrThrow({ where: { id: targetId }, select: { body: true } })
      const images = await tx.postImage.findMany({
        where: { postId: targetId, position: { not: null } },
        orderBy: { position: 'asc' },
        select: { id: true },
      })
      const imageIds = images.map((image) => image.id)
      if (imageIds.length > 0) {
        await tx.postImage.updateMany({ where: { id: { in: imageIds } }, data: { evidenceHold: true } })
      }
      return { authorId: post.author_id, version: post.version, text: row.body, imageIds, postId: targetId }
    }
    const { comment } = await lockVisibleComment(tx, targetId, viewerId, 'SHARE')
    if (comment.state !== 'VISIBLE') throw new ConflictError('This comment was deleted by its author.')
    const row = await tx.comment.findUniqueOrThrow({ where: { id: targetId }, select: { body: true } })
    return {
      authorId: comment.author_id,
      version: comment.version,
      text: row.body,
      imageIds: [],
      postId: comment.post_id,
    }
  }

  /**
   * Called by ModerationService when a report is upheld: a VISIBLE post or comment becomes
   * HIDDEN. Content its author already archived or deleted is left as it is.
   */
  async hideContent(tx: Tx, targetType: PublishingTargetType, targetId: string): Promise<void> {
    const now = this.deps.clock.now()
    if (targetType === 'POST') {
      const post = await lockPost(tx, targetId, 'UPDATE')
      if (!post) throw new NotFoundError('The post was not found.')
      if (post.state !== 'VISIBLE') return
      await tx.post.update({
        where: { id: targetId },
        data: { state: 'HIDDEN', version: { increment: 1 }, updatedAt: now },
      })
      return
    }
    const comment = await lockComment(tx, targetId, 'UPDATE')
    if (!comment) throw new NotFoundError('The comment was not found.')
    if (comment.state !== 'VISIBLE') return
    await tx.comment.update({
      where: { id: targetId },
      data: { state: 'HIDDEN', version: { increment: 1 }, updatedAt: now },
    })
  }

  /**
   * Locks held evidence images before ModerationService checks which are still referenced, so a
   * report captured meanwhile is seen.
   */
  async lockEvidenceImages(tx: Tx, imageIds: readonly string[]): Promise<void> {
    if (imageIds.length === 0) return
    await tx.$queryRaw`SELECT id FROM post_image WHERE id = ANY(${[...imageIds]}::uuid[]) FOR UPDATE`
  }

  /**
   * Called by ModerationService once no evidence refers to these images: ends the hold, removes
   * the images that were dropped from their post or whose post was deleted, and returns their
   * storage keys for removal after the commit. Images still shown on a post stay.
   */
  async releaseEvidenceImages(tx: Tx, imageIds: readonly string[]): Promise<string[]> {
    if (imageIds.length === 0) return []
    const ids = [...imageIds]
    await tx.postImage.updateMany({ where: { id: { in: ids } }, data: { evidenceHold: false } })
    const where = {
      id: { in: ids },
      OR: [{ position: null }, { post: { state: 'ARCHIVED' as const } }],
    }
    const dropped = await tx.postImage.findMany({ where, select: { storageKey: true } })
    await tx.postImage.deleteMany({ where })
    return dropped.map((image) => image.storageKey)
  }

  /** The given storage keys that a post image still refers to (orphan file sweep). */
  async findStoredKeys(keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set()
    const rows = await this.deps.db.postImage.findMany({
      where: { storageKey: { in: [...keys] } },
      select: { storageKey: true },
    })
    return new Set(rows.map((row) => row.storageKey))
  }

  /** Signed links to held evidence images, for Administrators reviewing a report. */
  async evidenceImages(imageIds: readonly string[]): Promise<Map<string, EvidenceImageView>> {
    if (imageIds.length === 0) return new Map()
    const rows = await this.deps.db.postImage.findMany({
      where: { id: { in: [...imageIds] } },
      select: { id: true, storageKey: true, altText: true },
    })
    const urls = await this.deps.storage.createSignedUrls(rows.map((row) => row.storageKey))
    const result = new Map<string, EvidenceImageView>()
    for (const row of rows) {
      const url = urls.get(row.storageKey)
      if (url) result.set(row.id, { url, altText: row.altText })
    }
    return result
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Early check before any file is stored; repeated on the locked account row in the transaction. */
  private publisher(actor: ActorContext): string {
    const memberId = this.member(actor)
    if (!actor.canInteract()) throw new PermissionDeniedError('Your account cannot do this.')
    if (actor.isRestrictedAt(this.deps.clock.now()) && actor.restrictedUntil) {
      throw new RestrictionError(actor.restrictedUntil)
    }
    return memberId
  }

  /**
   * Processes every new image first, so an unaccepted file stores nothing, then uploads them.
   * Returns the keys in slot order of the new images.
   */
  private async storeImages(
    memberId: string,
    slots: readonly ImageSlot[],
    files: readonly Uint8Array[],
  ): Promise<string[]> {
    const newSlots = slots.flatMap((slot, index) => (slot.imageId === null ? [index] : []))
    if (newSlots.length !== files.length) {
      throw new ValidationError({ images: 'Attach one file for each new image.' })
    }
    const prepared = []
    for (const [order, file] of files.entries()) {
      prepared.push(await this.deps.images.process(file, 'POST', `images.${newSlots[order]}`))
    }
    const keys: string[] = []
    try {
      for (const image of prepared) {
        const key = `${POST_BUCKET}/${memberId}/${randomUUID()}.${image.extension}`
        await this.deps.storage.upload(key, image.bytes, image.contentType)
        keys.push(key)
      }
    } catch (error) {
      await this.removeFiles(keys)
      throw error
    }
    return keys
  }

  private async saveImages(
    tx: Tx,
    postId: string,
    slots: readonly ImageSlot[],
    existing: Map<string, { id: string; storageKey: string; evidenceHold: boolean; createdAt: Date }>,
    newKeys: readonly string[],
  ): Promise<void> {
    let next = 0
    const data = []
    for (const [index, slot] of slots.entries()) {
      const kept = slot.imageId === null ? undefined : existing.get(slot.imageId)
      const common = { postId, position: index + 1, altText: slot.altText }
      if (kept?.evidenceHold) {
        await tx.postImage.update({
          where: { id: kept.id },
          data: { position: common.position, altText: common.altText },
        })
      } else if (kept) {
        data.push({
          ...common,
          id: kept.id,
          storageKey: kept.storageKey,
          evidenceHold: kept.evidenceHold,
          createdAt: kept.createdAt,
        })
      } else {
        const storageKey = newKeys[next++]
        if (!storageKey) throw new ValidationError({ images: 'Attach one file for each new image.' })
        data.push({ ...common, storageKey })
      }
    }
    if (data.length > 0) await tx.postImage.createMany({ data })
  }

  private async removeFiles(keys: readonly string[]): Promise<void> {
    await removeStoredFiles(this.deps.storage, this.deps.logger, keys)
  }
}
