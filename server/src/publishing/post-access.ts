import type { CommentState, PostState } from '@hilcoe/shared'
import { NotFoundError, type Tx } from '../kernel/index.js'

export interface LockedPost {
  id: string
  author_id: string
  state: PostState
  version: number
}

export interface LockedComment {
  id: string
  post_id: string
  parent_comment_id: string | null
  author_id: string
  state: CommentState
  version: number
}

/**
 * A HIDDEN post is seen only by its author; every other member is told it does not exist.
 * VISIBLE and ARCHIVED posts are seen by every member.
 */
export function canSeePost(post: { state: PostState; authorId: string }, memberId: string): boolean {
  return post.state !== 'HIDDEN' || post.authorId === memberId
}

/** Locks the post row: UPDATE for changes to the post, SHARE to keep its state while adding to it. */
export async function lockPost(tx: Tx, postId: string, mode: 'UPDATE' | 'SHARE'): Promise<LockedPost | null> {
  const rows =
    mode === 'UPDATE'
      ? await tx.$queryRaw<LockedPost[]>`
          SELECT id, author_id, state, version FROM post WHERE id = ${postId}::uuid FOR UPDATE`
      : await tx.$queryRaw<LockedPost[]>`
          SELECT id, author_id, state, version FROM post WHERE id = ${postId}::uuid FOR SHARE`
  return rows[0] ?? null
}

/** Locks a post the member may see, or reports it as not found. */
export async function lockVisiblePost(
  tx: Tx,
  postId: string,
  memberId: string,
  mode: 'UPDATE' | 'SHARE',
): Promise<LockedPost> {
  const post = await lockPost(tx, postId, mode)
  if (!post || !canSeePost({ state: post.state, authorId: post.author_id }, memberId)) {
    throw new NotFoundError('The post was not found.')
  }
  return post
}

export async function lockComment(
  tx: Tx,
  commentId: string,
  mode: 'UPDATE' | 'SHARE',
): Promise<LockedComment | null> {
  const rows =
    mode === 'UPDATE'
      ? await tx.$queryRaw<LockedComment[]>`
          SELECT id, post_id, parent_comment_id, author_id, state, version FROM comment
          WHERE id = ${commentId}::uuid FOR UPDATE`
      : await tx.$queryRaw<LockedComment[]>`
          SELECT id, post_id, parent_comment_id, author_id, state, version FROM comment
          WHERE id = ${commentId}::uuid FOR SHARE`
  return rows[0] ?? null
}

/**
 * Locks a comment the member may see together with its post (comment first, then post). A
 * HIDDEN comment, or a comment on a post the member may not see, is reported as not found.
 */
export async function lockVisibleComment(
  tx: Tx,
  commentId: string,
  memberId: string,
  mode: 'UPDATE' | 'SHARE',
): Promise<{ comment: LockedComment; post: LockedPost }> {
  const comment = await lockComment(tx, commentId, mode)
  if (!comment || comment.state === 'HIDDEN') throw new NotFoundError('The comment was not found.')
  const post = await lockPost(tx, comment.post_id, 'SHARE')
  if (!post || !canSeePost({ state: post.state, authorId: post.author_id }, memberId)) {
    throw new NotFoundError('The comment was not found.')
  }
  return { comment, post }
}
