import {
  likeTargetTypeSchema,
  pageRequestSchema,
  type LikeTargetType,
  type LikeView,
  type MemberCardView,
  type Page,
} from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import { deletedCard, type AccessPolicy } from '../identity/index.js'
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  pageWindow,
  parseInput,
  toPage,
  type ActorContext,
  type Clock,
  type TransactionRunner,
  type Tx,
} from '../kernel/index.js'
import type { NotificationService } from '../notifications/index.js'
import { canSeePost, lockVisibleComment, lockVisiblePost } from './post-access.js'
import type { PostViews } from './post-views.js'

export interface InteractionServiceDeps {
  db: PrismaClient
  transactions: TransactionRunner
  clock: Clock
  access: AccessPolicy
  notifications: NotificationService
  views: PostViews
}

interface LikeTarget {
  authorId: string
  /** True while the item accepts new likes: a VISIBLE comment on a VISIBLE post. */
  open: boolean
  where: { postId: string } | { commentId: string }
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Likes and counted views (ODD Table 10). */
export class InteractionService {
  constructor(private readonly deps: InteractionServiceDeps) {}

  /** Idempotent; only the member's first like of the item notifies its author. */
  async like(actor: ActorContext, targetType: unknown, targetId: string): Promise<LikeView> {
    const type = this.interactor(actor, targetType)
    return this.deps.transactions.run(async (tx) => {
      await this.deps.access.assertCanInteract(tx, actor)
      const target = await this.lockTarget(tx, actor.accountId, type, targetId)
      if (target.authorId === actor.accountId)
        throw new PermissionDeniedError('You cannot like your own content.')
      if (!target.open) throw new ConflictError('This item accepts no new likes.')
      const key = this.likeKey(actor.accountId, target)
      const existing = await tx.like.findUnique({ where: key, select: { id: true, active: true } })
      const now = this.deps.clock.now()
      if (!existing) {
        await tx.like.create({
          data: { memberId: actor.accountId, ...target.where, createdAt: now, updatedAt: now },
        })
        await this.deps.notifications.notify(tx, {
          recipientId: target.authorId,
          type: 'LIKE',
          eventKey: `like:${type.toLowerCase()}:${targetId}:${actor.accountId}`,
          actorId: actor.accountId,
          targetType: type,
          targetId,
        })
      } else if (!existing.active) {
        await tx.like.update({ where: { id: existing.id }, data: { active: true, updatedAt: now } })
      }
      return { liked: true, likeCount: await this.countLikes(tx, target) }
    })
  }

  /** Idempotent; also allowed on an archived post. */
  async unlike(actor: ActorContext, targetType: unknown, targetId: string): Promise<LikeView> {
    const type = this.interactor(actor, targetType)
    return this.deps.transactions.run(async (tx) => {
      await this.deps.access.assertCanInteract(tx, actor)
      const target = await this.lockTarget(tx, actor.accountId, type, targetId)
      await tx.like.updateMany({
        where: { memberId: actor.accountId, ...target.where, active: true },
        data: { active: false, updatedAt: this.deps.clock.now() },
      })
      return { liked: false, likeCount: await this.countLikes(tx, target) }
    })
  }

  /** The members who like the item, most recent first; deleted accounts appear as Deleted User. */
  async listLikers(
    actor: ActorContext,
    targetType: unknown,
    targetId: string,
    page: unknown,
  ): Promise<Page<MemberCardView>> {
    const memberId = this.member(actor)
    const type = parseInput(likeTargetTypeSchema, targetType)
    const request = parseInput(pageRequestSchema, page)
    const where = { ...(await this.readTarget(memberId, type, targetId)), active: true }
    const [rows, total] = await Promise.all([
      this.deps.db.like.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { memberId: true },
        ...pageWindow(request),
      }),
      this.deps.db.like.count({ where }),
    ])
    const cards = await this.deps.views.memberCards(rows.map((row) => row.memberId))
    return toPage(
      rows.map((row) => cards.get(row.memberId) ?? deletedCard()),
      request,
      total,
    )
  }

  /**
   * Counts one view per member, post and UTC day; never for the author or an Administrator, and
   * only while the post is VISIBLE. Marks of earlier days are removed on the way.
   */
  async recordView(actor: ActorContext, postId: string): Promise<void> {
    if (!actor.isMember) return
    const memberId = actor.accountId
    const post = await this.deps.db.post.findUnique({
      where: { id: postId },
      select: { state: true, authorId: true },
    })
    if (!post || !canSeePost(post, memberId)) throw new NotFoundError('The post was not found.')
    if (post.authorId === memberId || post.state !== 'VISIBLE') return
    const today = utcDate(this.deps.clock.now())
    await this.deps.transactions.run(async (tx) => {
      await tx.$executeRaw`DELETE FROM post_view_day WHERE utc_date < ${today}::date`
      const inserted = await tx.$executeRaw`
        INSERT INTO post_view_day (member_id, post_id, utc_date)
        VALUES (${memberId}::uuid, ${postId}::uuid, ${today}::date)
        ON CONFLICT DO NOTHING`
      if (inserted > 0) {
        await tx.$executeRaw`UPDATE post SET view_count = view_count + 1 WHERE id = ${postId}::uuid`
      }
    })
  }

  /** CleanupJob: removes the view marks of earlier UTC days. Returns the number removed. */
  async purgeViewMarks(now: Date): Promise<number> {
    return this.deps.db.$executeRaw`DELETE FROM post_view_day WHERE utc_date < ${utcDate(now)}::date`
  }

  private member(actor: ActorContext): string {
    if (!actor.isMember) throw new PermissionDeniedError('This is for community members.')
    return actor.accountId
  }

  /** Early check; repeated on the locked account row inside the transaction. */
  private interactor(actor: ActorContext, targetType: unknown): LikeTargetType {
    this.member(actor)
    if (!actor.canInteract()) throw new PermissionDeniedError('Your account cannot like content.')
    return parseInput(likeTargetTypeSchema, targetType)
  }

  private async lockTarget(
    tx: Tx,
    memberId: string,
    type: LikeTargetType,
    targetId: string,
  ): Promise<LikeTarget> {
    if (type === 'POST') {
      const post = await lockVisiblePost(tx, targetId, memberId, 'SHARE')
      return { authorId: post.author_id, open: post.state === 'VISIBLE', where: { postId: targetId } }
    }
    const { comment, post } = await lockVisibleComment(tx, targetId, memberId, 'SHARE')
    if (comment.state !== 'VISIBLE') throw new NotFoundError('The comment was not found.')
    return {
      authorId: comment.author_id,
      open: post.state === 'VISIBLE',
      where: { commentId: targetId },
    }
  }

  /** The like filter of an item the member may see. */
  private async readTarget(
    memberId: string,
    type: LikeTargetType,
    targetId: string,
  ): Promise<{ postId: string } | { commentId: string }> {
    if (type === 'POST') {
      const post = await this.deps.db.post.findUnique({
        where: { id: targetId },
        select: { state: true, authorId: true },
      })
      if (!post || !canSeePost(post, memberId)) throw new NotFoundError('The post was not found.')
      return { postId: targetId }
    }
    const comment = await this.deps.db.comment.findUnique({
      where: { id: targetId },
      select: { state: true, post: { select: { state: true, authorId: true } } },
    })
    if (!comment || comment.state !== 'VISIBLE' || !canSeePost(comment.post, memberId)) {
      throw new NotFoundError('The comment was not found.')
    }
    return { commentId: targetId }
  }

  private likeKey(memberId: string, target: LikeTarget) {
    return 'postId' in target.where
      ? { memberId_postId: { memberId, postId: target.where.postId } }
      : { memberId_commentId: { memberId, commentId: target.where.commentId } }
  }

  private async countLikes(tx: Tx, target: LikeTarget): Promise<number> {
    return tx.like.count({ where: { ...target.where, active: true } })
  }
}
