import { z } from 'zod'
import type { CommentState, PostState } from './enums.js'
import type { MemberCardView } from './identity.js'
import { optionalText, requiredText, uuidSchema } from './text.js'

// publishing Input/View types (ODD Section 3.3, Tables 9 and 10).

export const POST_BODY_MAX = 10_000
export const POST_IMAGES_MAX = 4
export const POST_TAGS_MAX = 5
export const TAG_MAX = 30
export const ALT_TEXT_MAX = 250
export const COMMENT_BODY_MAX = 2000
/** Multipart field names of the post create and edit requests. */
export const POST_JSON_FIELD = 'post'
export const POST_IMAGES_FIELD = 'images'

const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,30}$/u

/** Tag.normalize: trims, removes one leading #, lower-cases; null when the result is not a valid tag. */
export function normalizeTag(input: string): string | null {
  const label = input.trim().replace(/^#/, '').toLowerCase()
  return TAG_PATTERN.test(label) ? label : null
}

export const tagSchema = z.string().transform((value, context) => {
  const label = normalizeTag(value)
  if (label === null) {
    context.addIssue({
      code: 'custom',
      message: `Use 1 to ${TAG_MAX} letters, digits, hyphens or underscores`,
    })
    return z.NEVER
  }
  return label
})

/**
 * One image slot of a post, in display order. imageId names an image the post already has;
 * null takes the next uploaded file.
 */
export const postImageSlotSchema = z.object({
  imageId: uuidSchema.nullish().transform((value) => value ?? null),
  altText: optionalText(ALT_TEXT_MAX),
})

const postFields = z.object({
  body: optionalText(POST_BODY_MAX),
  tags: z
    .array(tagSchema)
    .default([])
    .transform((tags) => [...new Set(tags)])
    .pipe(z.array(z.string()).max(POST_TAGS_MAX, `At most ${POST_TAGS_MAX} tags`)),
  images: z.array(postImageSlotSchema).max(POST_IMAGES_MAX, `At most ${POST_IMAGES_MAX} images`).default([]),
})

/** A post is never empty: it has text, at least one image, or both (Manage Own Post). */
const notEmpty = (post: { body: string | null; images: unknown[] }) =>
  post.body !== null || post.images.length > 0
const NOT_EMPTY = { message: 'Write something or add an image', path: ['body'] }

export const postInputSchema = postFields.refine(notEmpty, NOT_EMPTY)
export type PostInput = z.input<typeof postInputSchema>
export type ParsedPostInput = z.output<typeof postInputSchema>

/** An edit carries the version the author last read. */
export const postEditInputSchema = postFields
  .extend({ version: z.number().int().min(1) })
  .refine(notEmpty, NOT_EMPTY)
export type PostEditInput = z.input<typeof postEditInputSchema>
export type ParsedPostEditInput = z.output<typeof postEditInputSchema>

export const commentInputSchema = z.object({
  body: requiredText(COMMENT_BODY_MAX),
  /** A reply to a reply attaches to the same top-level comment. */
  parentCommentId: uuidSchema.nullish().transform((value) => value ?? null),
})
export type CommentInput = z.input<typeof commentInputSchema>

export const commentEditInputSchema = z.object({
  body: requiredText(COMMENT_BODY_MAX),
  version: z.number().int().min(1),
})
export type CommentEditInput = z.input<typeof commentEditInputSchema>

export const LIKE_TARGET_TYPES = ['POST', 'COMMENT'] as const
export const likeTargetTypeSchema = z.enum(LIKE_TARGET_TYPES)
export type LikeTargetType = z.infer<typeof likeTargetTypeSchema>

export interface PostImageView {
  id: string
  /** Signed link valid for 60 seconds. */
  url: string
  altText: string | null
  position: number
}

/**
 * A post as shown in lists and on its detail page. An ARCHIVED post (deleted by its author) keeps
 * its tags, comments and saves but has no text or images.
 */
export interface PostSummaryView {
  id: string
  author: MemberCardView
  body: string | null
  images: PostImageView[]
  tags: string[]
  state: PostState
  version: number
  likeCount: number
  /** Visible comments and replies. */
  commentCount: number
  /** Aggregate of counted views; never who viewed. */
  viewCount: number
  /** Aggregate only; never who saved. */
  saveCount: number
  likedByMe: boolean
  savedByMe: boolean
  isOwn: boolean
  createdAt: string
  /** Set once the post has been edited. */
  editedAt: string | null
}

export type PostView = PostSummaryView

/**
 * A comment or reply. A DELETED or HIDDEN comment is a placeholder (no author or text) kept only
 * while it has visible replies.
 */
export interface CommentView {
  id: string
  postId: string
  parentCommentId: string | null
  author: MemberCardView | null
  body: string | null
  state: CommentState
  version: number
  likeCount: number
  likedByMe: boolean
  isOwn: boolean
  createdAt: string
  editedAt: string | null
  /** Replies oldest first; always empty for a reply. */
  replies: CommentView[]
}

export interface LikeView {
  liked: boolean
  likeCount: number
}
