import type { Tx } from './transaction.js'

/**
 * Reads a member's current restriction inside a transaction, so publishing rules are checked
 * against the locked account rather than the request's ActorContext. Implemented by moderation
 * and given to identity at start-up.
 */
export interface RestrictionReader {
  /** The latest end of a restriction still in force at `now`, or null. */
  restrictedUntil(tx: Tx, memberId: string, now: Date): Promise<Date | null>
}

/**
 * A copy of reported content taken as moderation evidence (ODD Tables 10 and 16). Returned by
 * the publishing and opportunities packages to ModerationService.
 */
export interface ContentSnapshot {
  authorId: string
  version: number
  text: string | null
  /** Post images now held as evidence (PostImage.evidenceHold). */
  imageIds: string[]
  /** The post of a post or comment, for linking; null for a listing. */
  postId: string | null
}
