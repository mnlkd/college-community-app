import type { ActorContextView, MemberCardView, PostSummaryView } from '@hilcoe/shared'
import { Bookmark, Heart, MessageCircle, Pencil, UserX } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isApiError, useToggleLike, useToggleSave } from '../../api'
import { RoleMark } from '../../design/content'
import { Avatar, Badge, Button, Card, Note, cx } from '../../design/ui'
import { ReportLink, canReport } from '../moderation/content'
import { timeAgo } from '../notifications/Notifications'
import { canInteract, canPublish } from './eligibility'

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

/** Plain text with paragraphs; web addresses become links that open in a new tab. */
export function LinkedText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_PATTERN)
  return (
    <p className={cx('break-words whitespace-pre-line', className)}>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-iris-11 underline hover:text-iris-9"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  )
}

export function TagLink({ tag }: { tag: string }) {
  return (
    <Link
      to={`/search?tag=${encodeURIComponent(tag)}`}
      className="font-display text-[12.5px] font-semibold text-iris-11 hover:text-iris-9"
    >
      #{tag}
    </Link>
  )
}

/** A member's name, picture and role; a deleted account shows "Deleted User" with no profile link. */
export function MemberLine({
  member,
  size = 42,
  meta,
}: {
  member: MemberCardView
  size?: number
  meta?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {member.deleted ? (
        <span
          className="flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-7"
          style={{ width: size, height: size }}
        >
          <UserX className="size-5 text-slate-9" aria-hidden="true" />
        </span>
      ) : (
        <Avatar name={member.displayName} size={size} src={member.pictureUrl ?? undefined} />
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {member.memberId && !member.deleted ? (
            <Link
              to={`/members/${member.memberId}`}
              className="font-display text-[14.5px] font-bold text-slate-12 hover:underline"
            >
              {member.displayName}
            </Link>
          ) : (
            <span className="font-display text-[14.5px] font-bold text-slate-10">{member.displayName}</span>
          )}
          {member.role && <RoleMark role={member.role} alumniStatus={member.alumniStatus} />}
        </div>
        {meta && <p className="mt-0.5 text-[12.5px] text-slate-10">{meta}</p>}
      </div>
    </div>
  )
}

/**
 * Post images, never cropped where they are the focus: the detail page shows each image whole, and
 * a feed card shows a single image whole (letterboxed when very tall). Several images in a feed
 * card become cropped square tiles that open the post.
 */
export function PostImages({ post, full = false }: { post: PostSummaryView; full?: boolean }) {
  if (post.images.length === 0) return null
  const frame = 'w-full rounded-lg border border-slate-5 bg-slate-2'
  if (full) {
    return (
      <div className="mt-3 space-y-2">
        {post.images.map((image) => (
          <img
            key={image.id}
            src={image.url}
            alt={image.altText ?? ''}
            className={cx(frame, 'h-auto max-h-[80vh] object-contain')}
          />
        ))}
      </div>
    )
  }
  const tiled = post.images.length > 1
  return (
    // The card already has keyboard links to the post; this one is for pointer users.
    <Link
      to={`/posts/${post.id}`}
      tabIndex={-1}
      aria-label={tiled ? `Open post with ${post.images.length} images` : 'Open post image'}
      className={cx('mt-3 grid gap-2', tiled && 'grid-cols-2')}
    >
      {post.images.map((image) => (
        <img
          key={image.id}
          src={image.url}
          alt={image.altText ?? ''}
          className={cx(frame, tiled ? 'aspect-square object-cover' : 'h-auto max-h-[32rem] object-contain')}
        />
      ))}
    </Link>
  )
}

export function ActionButton({
  icon,
  label,
  children,
  pressed,
  disabled,
  onClick,
}: {
  icon: ReactNode
  label: string
  children?: ReactNode
  pressed?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-slate-10 hover:bg-slate-3',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed && 'bg-iris-3 text-iris-11',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Like, comment and save controls for a post, with any error from the last action. */
export function PostActions({ post, actor }: { post: PostSummaryView; actor: ActorContextView }) {
  const like = useToggleLike(actor.accountId)
  const save = useToggleSave(actor.accountId)
  const open = post.state === 'VISIBLE'
  const interact = canInteract(actor)
  const error = like.error ?? save.error
  return (
    <>
      <div className="mt-3 flex items-center gap-1 border-t border-slate-4 pt-2.5">
        <ActionButton
          icon={<Heart className={cx('size-[17px]', post.likedByMe && 'fill-current')} />}
          label={post.likedByMe ? 'Unlike post' : 'Like post'}
          pressed={post.likedByMe}
          disabled={like.isPending || post.isOwn || (!post.likedByMe && (!interact || !open))}
          onClick={() => like.mutate({ type: 'POST', id: post.id, like: !post.likedByMe })}
        >
          <span data-testid="like-count">{post.likeCount}</span>
        </ActionButton>
        <Link
          to={`/posts/${post.id}`}
          aria-label={`Comments: ${post.commentCount}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[12px] text-slate-10 hover:bg-slate-3"
        >
          <MessageCircle className="size-[17px]" />
          {post.commentCount}
        </Link>
        <ActionButton
          icon={<Bookmark className={cx('size-4', post.savedByMe && 'fill-current')} />}
          label={post.savedByMe ? 'Remove from saved items' : 'Save post'}
          pressed={post.savedByMe}
          disabled={save.isPending || (!post.savedByMe && (!interact || !open))}
          onClick={() => save.mutate({ type: 'POST', id: post.id, save: !post.savedByMe })}
        >
          {post.savedByMe ? 'Saved' : 'Save'}
        </ActionButton>
        {open && canReport(actor, post.isOwn) && (
          <span className="ml-auto">
            <ReportLink
              type="POST"
              id={post.id}
              context={{
                back: `/posts/${post.id}`,
                author: post.author.displayName,
                excerpt: post.body ? post.body.slice(0, 300) : null,
              }}
            />
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-red-11">
          {isApiError(error) && error.status === 409 ? 'This post no longer accepts changes.' : error.message}
        </p>
      )}
    </>
  )
}

/** The edited and state labels shown beside a post's age. */
function PostMeta({ post }: { post: PostSummaryView }) {
  return (
    <>
      <time dateTime={post.createdAt}>{timeAgo(post.createdAt)}</time>
      {post.editedAt && <span> · edited</span>}
    </>
  )
}

export function ArchivedNote() {
  return (
    <Note>
      Deleted post. The original text and images were removed by the author; the tags and discussion remain
      read-only.
    </Note>
  )
}

/** A post in a list, linking to its detail page. */
export function PostCard({ post, actor }: { post: PostSummaryView; actor: ActorContextView }) {
  const archived = post.state === 'ARCHIVED'
  return (
    <Card hover className="px-5 py-4">
      <article aria-label={`Post by ${post.author.displayName}`}>
        <div className="flex items-start justify-between gap-2">
          <MemberLine member={post.author} meta={<PostMeta post={post} />} />
          <div className="flex shrink-0 items-center gap-1.5">
            {post.state === 'HIDDEN' && <Badge tone="red">Hidden by moderation</Badge>}
            {archived && <Badge>Deleted post</Badge>}
            {post.isOwn && post.state === 'VISIBLE' && canPublish(actor) && (
              <Link
                to={`/posts/${post.id}/edit`}
                aria-label="Edit my post"
                className="flex size-7 items-center justify-center rounded-full text-slate-9 hover:bg-slate-3"
              >
                <Pencil className="size-4" />
              </Link>
            )}
          </div>
        </div>
        {archived ? (
          <p className="mt-2.5 text-[14px] text-slate-10 italic">Deleted post: text and images removed.</p>
        ) : (
          post.body && (
            <Link
              to={`/posts/${post.id}`}
              className="mt-2.5 block text-[14.5px] leading-[1.62] text-slate-12"
            >
              <span className="line-clamp-6 break-words whitespace-pre-line">{post.body}</span>
            </Link>
          )
        )}
        <PostImages post={post} />
        {post.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
            {post.tags.map((tag) => (
              <TagLink key={tag} tag={tag} />
            ))}
          </div>
        )}
        <PostActions post={post} actor={actor} />
        <Link to={`/posts/${post.id}`} className="sr-only">
          Open post by {post.author.displayName}
        </Link>
      </article>
    </Card>
  )
}

/** Offset pagination controls; hidden when everything fits on one page. */
export function Pager({
  page,
  total,
  pageSize,
  onPage,
  previous = 'Newer',
  next = 'Older',
}: {
  page: number
  total: number
  pageSize: number
  onPage: (page: number) => void
  previous?: string
  next?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1 && page <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between">
      <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {previous}
      </Button>
      <span className="text-[13px] text-slate-10">
        Page {page} of {pages}
      </span>
      <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {next}
      </Button>
    </div>
  )
}
