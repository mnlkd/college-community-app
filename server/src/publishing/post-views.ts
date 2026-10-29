import type { CommentState, CommentView, MemberCardView, PostState, PostSummaryView } from '@hilcoe/shared'
import type { PrismaClient } from '../generated/prisma/client.js'
import { deletedCard, type AccountViews } from '../identity/index.js'
import type { FileStorage } from '../kernel/index.js'
import { canSeePost } from './post-access.js'

/**
 * Save facts the publishing package shows on a post without reading the boards tables. Implemented
 * by boards (which depends on publishing) and given at start-up, avoiding a package cycle.
 */
export interface PostSaveStats {
  /** Aggregate save count of each post, and whether the member saved it. */
  postSaves(
    memberId: string,
    postIds: readonly string[],
  ): Promise<Map<string, { count: number; savedByMe: boolean }>>
}

/** A post as the member may know it: its state, and its view unless the post is hidden from them. */
export interface PostDescription {
  state: PostState
  view: PostSummaryView | null
}

interface CommentRow {
  id: string
  postId: string
  parentCommentId: string | null
  authorId: string
  body: string | null
  state: CommentState
  version: number
  createdAt: Date
  updatedAt: Date
}

export const COMMENT_SELECT = {
  id: true,
  postId: true,
  parentCommentId: true,
  authorId: true,
  body: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
} as const

function editedAt(row: { version: number; updatedAt: Date }): string | null {
  return row.version > 1 ? row.updatedAt.toISOString() : null
}

/** Builds post and comment views with counts, the viewer's own like and save state and signed links. */
export class PostViews {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: FileStorage,
    private readonly accounts: AccountViews,
    private readonly saves: PostSaveStats,
  ) {}

  /** Describes the posts in the given order; unknown ids are left out. */
  async describe(viewerId: string, postIds: readonly string[]): Promise<Map<string, PostDescription>> {
    const ids = [...new Set(postIds)]
    const result = new Map<string, PostDescription>()
    if (ids.length === 0) return result
    const rows = await this.db.post.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        authorId: true,
        body: true,
        state: true,
        version: true,
        viewCount: true,
        createdAt: true,
        updatedAt: true,
        images: {
          where: { position: { not: null } },
          orderBy: { position: 'asc' },
          select: { id: true, storageKey: true, altText: true, position: true },
        },
        tags: { select: { tag: { select: { normalizedLabel: true } } } },
      },
    })
    const visible = rows.filter((row) => canSeePost(row, viewerId))
    const visibleIds = visible.map((row) => row.id)
    const showsImages = (row: { state: PostState }) => row.state !== 'ARCHIVED'
    const imageKeys = visible
      .filter(showsImages)
      .flatMap((row) => row.images.map((image) => image.storageKey))
    const [likeCounts, liked, commentCounts, saves, cards, urls] = await Promise.all([
      this.db.like.groupBy({
        by: ['postId'],
        where: { postId: { in: visibleIds }, active: true },
        _count: { _all: true },
      }),
      this.db.like.findMany({
        where: { postId: { in: visibleIds }, memberId: viewerId, active: true },
        select: { postId: true },
      }),
      this.db.comment.groupBy({
        by: ['postId'],
        where: { postId: { in: visibleIds }, state: 'VISIBLE' },
        _count: { _all: true },
      }),
      this.saves.postSaves(viewerId, visibleIds),
      this.accounts.memberCards(visible.map((row) => row.authorId)),
      imageKeys.length > 0
        ? this.storage.createSignedUrls(imageKeys)
        : Promise.resolve(new Map<string, string>()),
    ])
    const likeCount = new Map(likeCounts.map((row) => [row.postId, row._count._all]))
    const likedIds = new Set(liked.map((row) => row.postId))
    const commentCount = new Map(commentCounts.map((row) => [row.postId, row._count._all]))

    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const id of ids) {
      const row = byId.get(id)
      if (!row) continue
      if (!canSeePost(row, viewerId)) {
        result.set(id, { state: row.state, view: null })
        continue
      }
      const save = saves.get(id)
      const view: PostSummaryView = {
        id: row.id,
        author: cards.get(row.authorId) ?? deletedCard(),
        body: row.body,
        images: showsImages(row)
          ? row.images.flatMap((image) => {
              const url = urls.get(image.storageKey)
              return url && image.position !== null
                ? [{ id: image.id, url, altText: image.altText, position: image.position }]
                : []
            })
          : [],
        tags: row.tags.map((entry) => entry.tag.normalizedLabel).sort(),
        state: row.state,
        version: row.version,
        likeCount: likeCount.get(id) ?? 0,
        commentCount: commentCount.get(id) ?? 0,
        viewCount: row.viewCount,
        saveCount: save?.count ?? 0,
        likedByMe: likedIds.has(id),
        savedByMe: save?.savedByMe ?? false,
        isOwn: row.authorId === viewerId,
        createdAt: row.createdAt.toISOString(),
        editedAt: row.state === 'ARCHIVED' ? null : editedAt(row),
      }
      result.set(id, { state: row.state, view })
    }
    return result
  }

  async summaries(viewerId: string, postIds: readonly string[]): Promise<PostSummaryView[]> {
    const described = await this.describe(viewerId, postIds)
    return postIds.flatMap((id) => {
      const view = described.get(id)?.view
      return view ? [view] : []
    })
  }

  /**
   * Comment views; replies are attached to their top-level comment when both are given. A
   * DELETED or HIDDEN comment becomes a placeholder without author or text.
   */
  async comments(
    viewerId: string,
    topLevel: CommentRow[],
    replies: CommentRow[] = [],
  ): Promise<CommentView[]> {
    const all = [...topLevel, ...replies]
    const live = all.filter((row) => row.state === 'VISIBLE')
    const ids = live.map((row) => row.id)
    const [likeCounts, liked, cards] = await Promise.all([
      this.db.like.groupBy({
        by: ['commentId'],
        where: { commentId: { in: ids }, active: true },
        _count: { _all: true },
      }),
      this.db.like.findMany({
        where: { commentId: { in: ids }, memberId: viewerId, active: true },
        select: { commentId: true },
      }),
      this.accounts.memberCards(live.map((row) => row.authorId)),
    ])
    const likeCount = new Map(likeCounts.map((row) => [row.commentId, row._count._all]))
    const likedIds = new Set(liked.map((row) => row.commentId))

    const toView = (row: CommentRow): CommentView => {
      const placeholder = row.state !== 'VISIBLE'
      return {
        id: row.id,
        postId: row.postId,
        parentCommentId: row.parentCommentId,
        author: placeholder ? null : (cards.get(row.authorId) ?? deletedCard()),
        body: placeholder ? null : row.body,
        state: row.state,
        version: row.version,
        likeCount: placeholder ? 0 : (likeCount.get(row.id) ?? 0),
        likedByMe: !placeholder && likedIds.has(row.id),
        isOwn: !placeholder && row.authorId === viewerId,
        createdAt: row.createdAt.toISOString(),
        editedAt: placeholder ? null : editedAt(row),
        replies: [],
      }
    }
    const repliesOf = new Map<string, CommentView[]>()
    for (const reply of replies) {
      const parentId = reply.parentCommentId
      if (!parentId) continue
      repliesOf.set(parentId, [...(repliesOf.get(parentId) ?? []), toView(reply)])
    }
    return topLevel.map((row) => ({ ...toView(row), replies: repliesOf.get(row.id) ?? [] }))
  }

  async memberCards(memberIds: readonly string[]): Promise<Map<string, MemberCardView>> {
    return this.accounts.memberCards(memberIds)
  }
}
